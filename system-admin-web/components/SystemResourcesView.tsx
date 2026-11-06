"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import MemoryRoundedIcon from "@mui/icons-material/MemoryRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TableViewRoundedIcon from "@mui/icons-material/TableViewRounded";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid2";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

const bytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let amount = value;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 100 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
};

const rate = (value: number) => `${bytes(value)}/s`;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const points = useMemo(() => {
    if (!values.length) return "";
    const max = Math.max(...values, 1);
    const min = Math.min(...values);
    const span = Math.max(max - min, 1);
    return values.map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 94 - ((value - min) / span) * 84;
      return `${x},${y}`;
    }).join(" ");
  }, [values]);
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 70 }} aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Metric({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: ReactNode }) {
  return <Card sx={{ height: "100%" }}><CardContent><Stack direction="row" justifyContent="space-between" spacing={2}><Stack spacing={.5}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h5" fontWeight={900}>{value}</Typography><Typography variant="caption" color="text.secondary">{caption}</Typography></Stack><Stack sx={{ color: "primary.light", opacity: .9 }}>{icon}</Stack></Stack></CardContent></Card>;
}

export function SystemResourcesView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setError("");
    void api<any>("/system/resources").then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load system resources")).finally(() => setLoading(false));
  };

  useEffect(() => { load(); const timer = window.setInterval(load, 15_000); return () => window.clearInterval(timer); }, []);

  if (loading && !data) return <Typography color="text.secondary">Loading system telemetry…</Typography>;
  if (error && !data) return <Typography color="error.main">{error}</Typography>;
  if (!data?.latest) return <Typography color="text.secondary">No resource sample is available yet.</Typography>;

  const latest = data.latest;
  const history = data.history || [];
  const memory = latest.memory;
  const cpu = latest.cpu;
  const network = latest.network;
  const processes = latest.processes || [];
  const memoryValues = history.map((item: any) => Number(item.memory?.usagePercent || 0));
  const cpuValues = history.map((item: any) => Number(item.cpu?.systemPercent || 0));
  const rxValues = history.map((item: any) => Number(item.network?.rxBytesPerSecond || 0));
  const txValues = history.map((item: any) => Number(item.network?.txBytesPerSecond || 0));
  const memoryColor = memory.usagePercent >= 85 ? "#ff6b8a" : "#8b7dff";

  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={900}>System resources</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Live Railway container telemetry, runtime memory, CPU, network rates, and processes sorted by memory.</Typography></Box><Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={`PID ${data.runtime.pid}`} /><Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={load}>Refresh</Button></Stack></Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Card><CardContent><Stack spacing={1.2}><Stack direction="row" justifyContent="space-between" alignItems="center"><Stack direction="row" spacing={1} alignItems="center"><MemoryRoundedIcon color="primary" /><Typography variant="h6" fontWeight={850}>Container memory</Typography></Stack><Chip size="small" color={memory.usagePercent >= 85 ? "error" : memory.usagePercent >= 70 ? "warning" : "success"} label={`${memory.usagePercent}% used`} /></Stack><Typography color="text.secondary">{bytes(memory.usedBytes)} of {bytes(memory.limitBytes)} · cgroup limit when available</Typography><LinearProgress variant="determinate" value={Math.min(100, memory.usagePercent)} color={memory.usagePercent >= 85 ? "error" : memory.usagePercent >= 70 ? "warning" : "primary"} sx={{ height: 10, borderRadius: 5 }} /></Stack></CardContent></Card>
    <Grid container spacing={2}><Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Process RSS" value={bytes(memory.rssBytes)} caption="Node resident memory" icon={<MemoryRoundedIcon />} /></Grid><Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="V8 heap" value={bytes(memory.heapUsedBytes)} caption={`${bytes(memory.heapTotalBytes)} allocated`} icon={<MemoryRoundedIcon />} /></Grid><Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="CPU" value={`${cpu.systemPercent}%`} caption={`${cpu.processPercent}% Node process · ${cpu.cpuCount} cores`} icon={<SpeedRoundedIcon />} /></Grid><Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Network" value={`${rate(network.rxBytesPerSecond)}`} caption={`↓ receive · ↑ ${rate(network.txBytesPerSecond)}`} icon={<TableViewRoundedIcon />} /></Grid></Grid>
    <Grid container spacing={2}><Grid size={{ xs: 12, lg: 6 }}><Card><CardContent><Stack direction="row" justifyContent="space-between"><Typography variant="h6" fontWeight={850}>Memory trend</Typography><Typography color="text.secondary">last {history.length} samples</Typography></Stack><Sparkline values={memoryValues} color={memoryColor} /><Typography variant="caption" color="text.secondary">Container usage percentage · {bytes(memory.freeBytes)} available</Typography></CardContent></Card></Grid><Grid size={{ xs: 12, lg: 6 }}><Card><CardContent><Stack direction="row" justifyContent="space-between"><Typography variant="h6" fontWeight={850}>CPU trend</Typography><Typography color="text.secondary">load {cpu.loadAverage.join(" · ")}</Typography></Stack><Sparkline values={cpuValues} color="#45d5a2" /><Typography variant="caption" color="text.secondary">Host/container CPU percentage sampled every {data.sampleIntervalSeconds}s</Typography></CardContent></Card></Grid><Grid size={{ xs: 12, lg: 6 }}><Card><CardContent><Typography variant="h6" fontWeight={850}>Inbound network</Typography><Sparkline values={rxValues} color="#52c7f5" /><Typography variant="caption" color="text.secondary">{rate(network.rxBytesPerSecond)} now · {bytes(network.rxBytes)} total</Typography></CardContent></Card></Grid><Grid size={{ xs: 12, lg: 6 }}><Card><CardContent><Typography variant="h6" fontWeight={850}>Outbound network</Typography><Sparkline values={txValues} color="#f4c95d" /><Typography variant="caption" color="text.secondary">{rate(network.txBytesPerSecond)} now · {bytes(network.txBytes)} total</Typography></CardContent></Card></Grid></Grid>
    <Card><CardContent><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ mb: 1 }}><Box><Typography variant="h6" fontWeight={850}>Processes by memory</Typography><Typography color="text.secondary">OS-level process RSS, highest to lowest. Node modules run inside the Node PID and are represented by its RSS/heap metrics above.</Typography></Box><Chip size="small" label={`${processes.length} processes`} /></Stack><Table size="small"><TableHead><TableRow><TableCell>Process</TableCell><TableCell>PID</TableCell><TableCell align="right">RSS</TableCell><TableCell align="right">CPU</TableCell><TableCell align="right">Memory</TableCell></TableRow></TableHead><TableBody>{processes.map((process: any) => <TableRow key={`${process.pid}-${process.command}`} hover><TableCell sx={{ maxWidth: 480 }}><Typography fontWeight={750} noWrap>{process.name}</Typography><Typography variant="caption" color="text.secondary" noWrap display="block">{process.command}</Typography></TableCell><TableCell>{process.pid}</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{bytes(process.rssBytes)}</TableCell><TableCell align="right">{Number(process.cpuPercent || 0).toFixed(1)}%</TableCell><TableCell align="right">{Number(process.memoryPercent || 0).toFixed(2)}%</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <Typography variant="caption" color="text.secondary">Last sample: {new Date(latest.timestamp).toLocaleString()} · Runtime {data.runtime.nodeVersion} on {data.runtime.platform}/{data.runtime.arch} · uptime {Math.round(data.runtime.uptimeSeconds / 3600 * 10) / 10}h</Typography>
  </Stack>;
}
