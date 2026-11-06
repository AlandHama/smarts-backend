import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const SAMPLE_INTERVAL_MS = 15_000;
const MAX_HISTORY = 120;
const BYTES_PER_KIB = 1024;

type CpuSnapshot = { idle: number; total: number };
type NetworkSnapshot = { rxBytes: number; txBytes: number };

export type SystemResourceSample = {
  timestamp: string;
  memory: {
    usedBytes: number;
    limitBytes: number;
    freeBytes: number;
    usagePercent: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  cpu: {
    processPercent: number;
    systemPercent: number;
    loadAverage: number[];
    cpuCount: number;
  };
  network: {
    rxBytes: number;
    txBytes: number;
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
  };
  processes: Array<{
    pid: number;
    parentPid: number;
    name: string;
    command: string;
    rssBytes: number;
    cpuPercent: number;
    memoryPercent: number;
  }>;
};

@Injectable()
export class SystemResourcesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemResourcesService.name);
  private readonly history: SystemResourceSample[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private sampling = false;
  private previousCpu?: CpuSnapshot;
  private previousProcessCpu?: NodeJS.CpuUsage;
  private previousNetwork?: NetworkSnapshot;
  private previousNetworkAt?: number;
  private previousSampleAt?: number;

  onModuleInit() {
    void this.sample();
    this.timer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async current() {
    if (!this.history.length) await this.sample();
    const latest = this.history[this.history.length - 1];
    return {
      generatedAt: new Date().toISOString(),
      sampleIntervalSeconds: SAMPLE_INTERVAL_MS / 1000,
      runtime: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSeconds: Math.round(process.uptime()),
      },
      latest,
      history: this.history.slice(-60),
    };
  }

  private async sample() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const now = Date.now();
      const [memory, processes, network] = await Promise.all([
        this.memoryMetrics(),
        this.processes(),
        this.networkBytes(),
      ]);
      const cpus = os.cpus();
      const cpu = this.cpuMetrics(cpus, now);
      const sample: SystemResourceSample = {
        timestamp: new Date(now).toISOString(),
        memory,
        cpu,
        network: this.networkMetrics(network, now),
        processes,
      };
      this.history.push(sample);
      while (this.history.length > MAX_HISTORY) this.history.shift();
    } catch (error) {
      this.logger.warn(`Unable to sample system resources: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  private cpuMetrics(cpus: os.CpuInfo[], now: number) {
    const current = cpus.reduce<CpuSnapshot>(
      (totals, cpu) => ({
        idle: totals.idle + cpu.times.idle,
        total: totals.total + Object.values(cpu.times).reduce((sum, value) => sum + value, 0),
      }),
      { idle: 0, total: 0 },
    );
    const elapsedMs = Math.max(1, now - (this.previousSampleAt ?? now));
    const previous = this.previousCpu;
    const totalDelta = previous ? Math.max(1, current.total - previous.total) : 1;
    const idleDelta = previous ? Math.max(0, current.idle - previous.idle) : 0;
    const systemPercent = previous ? this.roundPercent(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
    const processUsage = process.cpuUsage(this.previousProcessCpu);
    this.previousProcessCpu = process.cpuUsage();
    const processPercent = previous
      ? this.roundPercent(((processUsage.user + processUsage.system) / 1000 / elapsedMs) * 100)
      : 0;
    this.previousCpu = current;
    this.previousSampleAt = now;
    return {
      processPercent,
      systemPercent,
      loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
      cpuCount: cpus.length,
    };
  }

  private networkMetrics(current: NetworkSnapshot, now: number) {
    const previous = this.previousNetwork;
    const elapsedSeconds = Math.max(1, (now - (this.previousNetworkAt ?? now)) / 1000);
    this.previousNetwork = current;
    this.previousNetworkAt = now;
    return {
      rxBytes: current.rxBytes,
      txBytes: current.txBytes,
      rxBytesPerSecond: previous ? Math.max(0, Math.round((current.rxBytes - previous.rxBytes) / elapsedSeconds)) : 0,
      txBytesPerSecond: previous ? Math.max(0, Math.round((current.txBytes - previous.txBytes) / elapsedSeconds)) : 0,
    };
  }

  private async memoryMetrics() {
    const usage = process.memoryUsage();
    const cgroup = await this.cgroupMemory();
    const usedBytes = cgroup.currentBytes ?? Math.max(0, os.totalmem() - os.freemem());
    const limitBytes = cgroup.limitBytes ?? os.totalmem();
    return {
      usedBytes,
      limitBytes,
      freeBytes: Math.max(0, limitBytes - usedBytes),
      usagePercent: this.roundPercent(limitBytes ? (usedBytes / limitBytes) * 100 : 0),
      rssBytes: usage.rss,
      heapUsedBytes: usage.heapUsed,
      heapTotalBytes: usage.heapTotal,
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers,
    };
  }

  private async cgroupMemory() {
    const [current, limit] = await Promise.all([
      this.readFirst([
        "/sys/fs/cgroup/memory.current",
        "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      ]),
      this.readFirst([
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      ]),
    ]);
    const currentBytes = this.parseBytes(current);
    const parsedLimit = this.parseBytes(limit);
    const limitBytes = parsedLimit && parsedLimit < Number.MAX_SAFE_INTEGER ? parsedLimit : undefined;
    return { currentBytes, limitBytes };
  }

  private async networkBytes(): Promise<NetworkSnapshot> {
    try {
      const content = await readFile("/proc/net/dev", "utf8");
      return content.split("\n").slice(2).reduce<NetworkSnapshot>((totals, line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return totals;
        const values = line.slice(separator + 1).trim().split(/\s+/).map(Number);
        if (values.length < 9) return totals;
        return { rxBytes: totals.rxBytes + (values[0] || 0), txBytes: totals.txBytes + (values[8] || 0) };
      }, { rxBytes: 0, txBytes: 0 });
    } catch {
      return { rxBytes: 0, txBytes: 0 };
    }
  }

  private async processes(): Promise<SystemResourceSample["processes"]> {
    try {
      const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,comm=,rss=,%cpu=,%mem=,args=", "--sort=-rss"], { maxBuffer: 512 * 1024 });
      return stdout.split("\n").map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          parentPid: Number(match[2]),
          name: match[3],
          command: match[7].slice(0, 240),
          rssBytes: Math.round(Number(match[4]) * BYTES_PER_KIB),
          cpuPercent: Number(match[5]),
          memoryPercent: Number(match[6]),
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null).slice(0, 30);
    } catch {
      const usage = process.memoryUsage();
      return [{ pid: process.pid, parentPid: process.ppid, name: "node", command: process.argv.join(" ").slice(0, 240), rssBytes: usage.rss, cpuPercent: 0, memoryPercent: 0 }];
    }
  }

  private async readFirst(paths: string[]) {
    for (const path of paths) {
      try { return await readFile(path, "utf8"); } catch { /* try the next cgroup layout */ }
    }
    return undefined;
  }

  private parseBytes(value: string | undefined) {
    if (!value || value.trim() === "max") return undefined;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private roundPercent(value: number) { return Number(Math.max(0, value).toFixed(2)); }
}
