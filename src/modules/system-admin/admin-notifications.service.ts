import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AdminNotificationSeverity, CryptoPayoutRequestStatus, FraudCaseStatus, FraudProfileStatus, FraudRiskLevel, PaidRewardRequestStatus, Prisma, SupportLiveChatStatus } from "@prisma/client";

import { PrismaService } from "../../prisma.service";
import { FirebaseMessagingService } from "../notifications/firebase-messaging.service";
import { SystemResourcesService } from "./system-resources.service";

const SYNC_INTERVAL_MS = 60_000;
const OPEN_FRAUD_CASES = [FraudCaseStatus.OPEN, FraudCaseStatus.IN_REVIEW, FraudCaseStatus.WATCH];
const SUSPICIOUS_RISK_LEVELS = [FraudRiskLevel.SUSPICIOUS, FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL];

type AdminNotificationData = Record<string, unknown>;

@Injectable()
export class AdminNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminNotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: SystemResourcesService,
    private readonly firebaseMessaging: FirebaseMessagingService,
  ) {}

  onModuleInit() {
    void this.sync();
    this.timer = setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async feed(limit = 100) {
    await this.sync();
    const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const [items, unreadCount, openCount, severityCounts, dailyProfit] = await Promise.all([
      this.prisma.adminNotification.findMany({ orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }], take }),
      this.prisma.adminNotification.count({ where: { readAt: null, resolvedAt: null } }),
      this.prisma.adminNotification.count({ where: { resolvedAt: null } }),
      this.prisma.adminNotification.groupBy({ by: ["severity"], where: { resolvedAt: null }, _count: { _all: true } }),
      this.todayProfit(),
    ]);
    return this.serialize({
      items,
      unreadCount,
      openCount,
      severityCounts: Object.fromEntries(severityCounts.map((row) => [row.severity.toLowerCase(), row._count._all])),
      dailyProfit,
      syncedAt: new Date(),
    });
  }

  async markRead(id: string) {
    const result = await this.prisma.adminNotification.updateMany({ where: { id }, data: { readAt: new Date() } });
    return { updated: result.count > 0 };
  }

  async markAllRead() {
    const result = await this.prisma.adminNotification.updateMany({ where: { readAt: null, resolvedAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  async resolve(id: string) {
    const result = await this.prisma.adminNotification.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } });
    return { updated: result.count > 0 };
  }

  async notifyLiveChatOpened(input: { sessionId: string; sessionNumber: string; playerId: string; username: string }) {
    await this.upsert({
      dedupeKey: `live-chat:${input.sessionId}`,
      category: "SUPPORT",
      severity: AdminNotificationSeverity.WARNING,
      title: "Player requested live chat",
      body: `${input.username} is waiting for an administrator in live chat (${input.sessionNumber}).`,
      data: { route: `/system-admin?section=liveChat&liveChatId=${input.sessionId}`, section: "liveChat", liveChatId: input.sessionId, playerId: input.playerId },
    });
  }

  private async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const [fraudCases, suspiciousProfiles, paidRewards, cryptoRewards, liveChats, failedOutbox, failedPurchases, failedPushes, openFeedback, reviewMatches] = await Promise.all([
        this.prisma.fraudCase.findMany({ where: { status: { in: OPEN_FRAUD_CASES } }, orderBy: { openedAt: "desc" }, take: 100, select: { id: true, userId: true, status: true, scoreAtOpen: true, reason: true, openedAt: true, user: { select: { username: true } } } }),
        this.prisma.fraudProfile.findMany({ where: { OR: [{ riskLevel: { in: SUSPICIOUS_RISK_LEVELS } }, { status: { in: [FraudProfileStatus.WATCH, FraudProfileStatus.RESTRICTED, FraudProfileStatus.SUSPENDED] } }] }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 100, select: { userId: true, score: true, riskLevel: true, status: true, lastSignalAt: true, user: { select: { username: true } } } }),
        this.prisma.paidRewardRequest.findMany({ where: { status: PaidRewardRequestStatus.PENDING }, orderBy: { requestedAt: "asc" }, take: 100, select: { id: true, userId: true, gldPrice: true, requestedAt: true, user: { select: { username: true } }, assetDefinition: { select: { name: true, key: true } } } }),
        this.prisma.cryptoPayoutRequest.findMany({ where: { status: CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL }, orderBy: { requestedAt: "asc" }, take: 100, select: { id: true, userId: true, gldRequested: true, currencyCode: true, networkCode: true, requestedAt: true, user: { select: { username: true } } } }),
        this.prisma.supportLiveChatSession.findMany({ where: { status: { in: [SupportLiveChatStatus.QUEUED, SupportLiveChatStatus.ASSIGNED, SupportLiveChatStatus.ACTIVE, SupportLiveChatStatus.PAUSED, SupportLiveChatStatus.WAITING_FOR_PLAYER] } }, orderBy: { queueEnteredAt: "asc" }, take: 100, select: { id: true, sessionNumber: true, playerId: true, status: true, player: { select: { username: true } } } }),
        this.prisma.outboxEvent.count({ where: { status: "FAILED" } }),
        this.prisma.purchase.count({ where: { status: "FAILED" } }),
        this.prisma.notification.count({ where: { pushStatus: "FAILED", createdAt: { gte: this.dayStart() } } }),
        this.prisma.playerFeedback.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
        this.prisma.match.count({ where: { status: "REVIEW" } }),
      ]);

      const activeFraudCaseKeys = fraudCases.map((row) => `fraud-case:${row.id}`);
      const activeFraudProfileKeys = suspiciousProfiles.map((row) => `fraud-profile:${row.userId}`);
      const activePaidRewardKeys = paidRewards.map((row) => `paid-reward:${row.id}`);
      const activeCryptoRewardKeys = cryptoRewards.map((row) => `crypto-reward:${row.id}`);
      const activeLiveChatKeys = liveChats.map((row) => `live-chat:${row.id}`);

      for (const row of fraudCases) {
        await this.upsert({
          dedupeKey: `fraud-case:${row.id}`,
          category: "FRAUD",
          severity: row.scoreAtOpen >= 80 ? AdminNotificationSeverity.CRITICAL : AdminNotificationSeverity.WARNING,
          title: "Suspicious user requires review",
          body: `${row.user.username} has an open risk case (${row.status}) with score ${row.scoreAtOpen}: ${row.reason}`,
          data: { route: "/fraud", userId: row.userId, caseId: row.id, score: row.scoreAtOpen },
        });
      }
      for (const row of suspiciousProfiles) {
        await this.upsert({
          dedupeKey: `fraud-profile:${row.userId}`,
          category: "FRAUD",
          severity: row.riskLevel === FraudRiskLevel.CRITICAL || row.status === FraudProfileStatus.SUSPENDED ? AdminNotificationSeverity.CRITICAL : AdminNotificationSeverity.WARNING,
          title: "Suspicious player detected",
          body: `${row.user.username} is ${row.riskLevel.toLowerCase()} risk with score ${row.score} and status ${row.status.toLowerCase()}.`,
          data: { route: "/fraud", userId: row.userId, score: row.score, riskLevel: row.riskLevel, status: row.status },
        });
      }
      for (const row of paidRewards) {
        await this.upsert({
          dedupeKey: `paid-reward:${row.id}`,
          category: "REWARD_REQUEST",
          severity: AdminNotificationSeverity.WARNING,
          title: "Player reward request pending",
          body: `${row.user.username} requested ${row.assetDefinition.name} for ${row.gldPrice?.toString() ?? "legacy"} GLD.`,
          data: { route: "/paid-rewards", requestId: row.id, userId: row.userId, rewardKey: row.assetDefinition.key, gldPrice: row.gldPrice?.toString() ?? null },
        });
      }
      for (const row of cryptoRewards) {
        await this.upsert({
          dedupeKey: `crypto-reward:${row.id}`,
          category: "REWARD_REQUEST",
          severity: AdminNotificationSeverity.CRITICAL,
          title: "Crypto reward request needs approval",
          body: `${row.user.username} requested ${row.gldRequested.toString()} GLD for ${row.currencyCode} on ${row.networkCode}.`,
          data: { route: "/crypto-rewards", requestId: row.id, userId: row.userId, currencyCode: row.currencyCode, networkCode: row.networkCode, gldRequested: row.gldRequested.toString() },
        });
      }
      for (const row of liveChats) {
        await this.upsert({
          dedupeKey: `live-chat:${row.id}`,
          category: "SUPPORT",
          severity: row.status === SupportLiveChatStatus.QUEUED ? AdminNotificationSeverity.WARNING : AdminNotificationSeverity.INFO,
          title: row.status === SupportLiveChatStatus.QUEUED ? "Player requested live chat" : "Live chat is active",
          body: `${row.player.username} · ${row.sessionNumber} · ${row.status.toLowerCase().replaceAll("_", " ")}.`,
          data: { route: `/system-admin?section=liveChat&liveChatId=${row.id}`, section: "liveChat", liveChatId: row.id, playerId: row.playerId, status: row.status },
        });
      }

      await this.resolveInactive("FRAUD", [...activeFraudCaseKeys, ...activeFraudProfileKeys]);
      await this.resolveInactive("REWARD_REQUEST", [...activePaidRewardKeys, ...activeCryptoRewardKeys]);
      await this.resolveInactive("SUPPORT", activeLiveChatKeys);
      await this.syncOperationalAlert("ops:failed-outbox", "OPERATIONS", failedOutbox > 0 ? AdminNotificationSeverity.CRITICAL : null, "Failed outbox events need attention", `${failedOutbox} outbox event${failedOutbox === 1 ? " is" : "s are"} currently failed.`, { route: "/operations", count: failedOutbox });
      await this.syncOperationalAlert("ops:failed-purchases", "OPERATIONS", failedPurchases > 0 ? AdminNotificationSeverity.WARNING : null, "Failed purchases detected", `${failedPurchases} purchase${failedPurchases === 1 ? " is" : "s are"} currently failed.`, { route: "/commerce", count: failedPurchases });
      await this.syncOperationalAlert("ops:failed-pushes", "OPERATIONS", failedPushes > 0 ? AdminNotificationSeverity.WARNING : null, "Push delivery failures", `${failedPushes} notification push${failedPushes === 1 ? " has" : "es have"} failed today.`, { route: "/notifications", count: failedPushes });
      await this.syncOperationalAlert("ops:open-feedback", "OPERATIONS", openFeedback > 0 ? AdminNotificationSeverity.INFO : null, "Player feedback is waiting", `${openFeedback} feedback item${openFeedback === 1 ? " is" : "s are"} open or in review.`, { route: "/feedback", count: openFeedback });
      await this.syncOperationalAlert("ops:match-review", "OPERATIONS", reviewMatches > 0 ? AdminNotificationSeverity.WARNING : null, "Matches are held for review", `${reviewMatches} match${reviewMatches === 1 ? " is" : "es are"} waiting for settlement review.`, { route: "/matches", count: reviewMatches });

      await this.syncDailyProfit();
      await this.syncResourceAlerts();
    } catch (error) {
      this.logger.warn(`Admin notification sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.syncing = false;
    }
  }

  private async syncDailyProfit() {
    const dateKey = new Date().toISOString().slice(0, 10);
    const from = this.dayStart();
    const totals = await this.prisma.gldRevenueSnapshot.aggregate({ where: { periodStart: { gte: from }, recognitionStatus: { in: ["RECOGNIZED", "RESTATED"] } }, _sum: { grossAdRevenueUsdMicros: true, rewardBackingUsdMicros: true, reserveAddedUsdMicros: true, companyShareUsdMicros: true }, _count: { id: true } });
    const company = totals._sum.companyShareUsdMicros ?? 0n;
    await this.upsert({ dedupeKey: `daily-profit:${dateKey}`, category: "ECONOMY", severity: AdminNotificationSeverity.INFO, title: "Today’s company profit", body: `${this.usd(company)} recognized company profit today from ${totals._count.id} revenue snapshot${totals._count.id === 1 ? "" : "s"}.`, data: { route: "/gld", dateKey, grossAdRevenueUsdMicros: (totals._sum.grossAdRevenueUsdMicros ?? 0n).toString(), rewardBackingUsdMicros: (totals._sum.rewardBackingUsdMicros ?? 0n).toString(), reserveAddedUsdMicros: (totals._sum.reserveAddedUsdMicros ?? 0n).toString(), companyProfitUsdMicros: company.toString(), snapshotCount: totals._count.id } });
  }

  private async syncResourceAlerts() {
    const snapshot = (await this.resources.current()).latest;
    if (!snapshot) return;
    const memorySeverity = snapshot.memory.usagePercent >= 90 ? AdminNotificationSeverity.CRITICAL : snapshot.memory.usagePercent >= 80 ? AdminNotificationSeverity.WARNING : null;
    await this.syncOperationalAlert("system:memory", "SYSTEM", memorySeverity, "Server memory usage is high", `Container memory is at ${snapshot.memory.usagePercent}% (${this.bytes(snapshot.memory.usedBytes)} of ${this.bytes(snapshot.memory.limitBytes)}).`, { route: "/system-resources", usagePercent: snapshot.memory.usagePercent });
    const cpu = Math.max(snapshot.cpu.systemPercent, snapshot.cpu.processPercent);
    const cpuSeverity = cpu >= 95 ? AdminNotificationSeverity.CRITICAL : cpu >= 85 ? AdminNotificationSeverity.WARNING : null;
    await this.syncOperationalAlert("system:cpu", "SYSTEM", cpuSeverity, "Server CPU usage is high", `CPU usage reached ${cpu}% (system ${snapshot.cpu.systemPercent}%, Node ${snapshot.cpu.processPercent}%).`, { route: "/system-resources", systemPercent: snapshot.cpu.systemPercent, processPercent: snapshot.cpu.processPercent });
  }

  private async syncOperationalAlert(dedupeKey: string, category: string, severity: AdminNotificationSeverity | null, title: string, body: string, data: AdminNotificationData) {
    if (!severity) {
      await this.prisma.adminNotification.updateMany({ where: { dedupeKey, resolvedAt: null }, data: { resolvedAt: new Date() } });
      return;
    }
    await this.upsert({ dedupeKey, category, severity, title, body, data });
  }

  private async upsert(input: { dedupeKey: string; category: string; severity: AdminNotificationSeverity; title: string; body: string; data?: AdminNotificationData }) {
    const existing = await this.prisma.adminNotification.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true, resolvedAt: true },
    });
    await this.prisma.adminNotification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: { dedupeKey: input.dedupeKey, category: input.category, severity: input.severity, title: input.title, body: input.body, data: input.data as Prisma.InputJsonValue },
      update: { category: input.category, severity: input.severity, title: input.title, body: input.body, data: input.data as Prisma.InputJsonValue, resolvedAt: null },
    });
    // The durable admin inbox is still authoritative, but newly-created
    // alerts also need to reach an administrator while the app is backgrounded.
    // Do this only for a new or previously resolved alert so the 60-second
    // synchronizer cannot create a push storm.
    if (!existing || existing.resolvedAt) {
      void this.pushToAdministrators(input).catch((error) => {
        this.logger.warn(`Admin alert push failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async pushToAdministrators(input: { dedupeKey: string; category: string; severity: AdminNotificationSeverity; title: string; body: string; data?: AdminNotificationData }) {
    const administrators = await this.prisma.user.findMany({
      where: { isSystemAdmin: true, status: "ACTIVE" },
      select: { id: true },
    });
    if (!administrators.length) return;
    const notificationData = Object.fromEntries(
      Object.entries(input.data ?? {}).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ]),
    );
    await this.firebaseMessaging.sendToUsers(administrators.map((admin) => admin.id), {
      notificationType: "admin.alert",
      title: input.title,
      body: input.body,
      data: {
        route: notificationData.route || "/system-admin",
        ...notificationData,
        category: input.category,
        severity: input.severity,
        dedupeKey: input.dedupeKey,
      },
    }, { throwOnTransientFailure: false });
  }

  private async resolveInactive(category: string, activeKeys: string[]) {
    if (!activeKeys.length) {
      await this.prisma.adminNotification.updateMany({ where: { category, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } });
      return;
    }
    await this.prisma.adminNotification.updateMany({ where: { category, resolvedAt: null, dedupeKey: { notIn: activeKeys } }, data: { resolvedAt: new Date(), readAt: new Date() } });
  }

  private async todayProfit() {
    const totals = await this.prisma.gldRevenueSnapshot.aggregate({ where: { periodStart: { gte: this.dayStart() }, recognitionStatus: { in: ["RECOGNIZED", "RESTATED"] } }, _sum: { grossAdRevenueUsdMicros: true, rewardBackingUsdMicros: true, reserveAddedUsdMicros: true, companyShareUsdMicros: true }, _count: { id: true } });
    return this.serialize({ dateKey: new Date().toISOString().slice(0, 10), grossAdRevenueUsdMicros: totals._sum.grossAdRevenueUsdMicros ?? 0n, rewardBackingUsdMicros: totals._sum.rewardBackingUsdMicros ?? 0n, reserveAddedUsdMicros: totals._sum.reserveAddedUsdMicros ?? 0n, companyProfitUsdMicros: totals._sum.companyShareUsdMicros ?? 0n, snapshotCount: totals._count.id });
  }

  private dayStart() { const start = new Date(); start.setUTCHours(0, 0, 0, 0); return start; }
  private usd(micros: bigint) { return `$${(Number(micros) / 1_000_000).toFixed(2)}`; }
  private bytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T; }
}
