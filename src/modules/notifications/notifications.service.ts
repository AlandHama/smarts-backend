import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  NotificationPushStatus,
  NotificationStatus,
  OutboxEventStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../prisma.service";
import { FirebaseMessagingService } from "./firebase-messaging.service";
import { RegisterDeviceTokenDto, SendGlobalNotificationDto } from "./dtos";

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseMessaging: FirebaseMessagingService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.processOutbox();
    }, 5000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async listForUser(userId: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return this.serialize(items);
  }

  async markRead(userId: string, id: string) {
    const item = await this.prisma.notification.updateMany({
      where: { id, userId, status: { not: NotificationStatus.READ } },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    return { updated: item.count > 0 };
  }

  async markAllRead(userId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { userId, status: { not: NotificationStatus.READ } },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    return { updated: updated.count };
  }

  registerDevice(userId: string, dto: RegisterDeviceTokenDto) {
    return this.firebaseMessaging.registerDevice(userId, dto);
  }

  unregisterDevice(userId: string, token: string) {
    return this.firebaseMessaging.unregisterDevice(userId, token);
  }

  pushStatus() {
    return this.firebaseMessaging.status();
  }

  async listBroadcasts() {
    const items = await this.prisma.notificationBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        recipientCount: true,
        pushSentCount: true,
        pushFailedCount: true,
        createdAt: true,
        createdBy: { select: { username: true, email: true } },
      },
    });
    return this.serialize(items);
  }

  async sendGlobalBroadcast(adminId: string, dto: SendGlobalNotificationDto) {
    const title = dto.title.trim();
    const body = dto.body.trim();
    const users = await this.prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const data = dto.route?.trim() ? { route: dto.route.trim() } : undefined;
    const broadcast = await this.prisma.notificationBroadcast.create({
      data: {
        createdById: adminId,
        title,
        body,
        data: data as Prisma.InputJsonValue | undefined,
        recipientCount: users.length,
      },
      select: { id: true },
    });

    for (let offset = 0; offset < users.length; offset += 500) {
      const batch = users.slice(offset, offset + 500);
      await this.prisma.notification.createMany({
        data: batch.map((user) => ({
          userId: user.id,
          broadcastId: broadcast.id,
          notificationType: "admin.global",
          title,
          body,
          data: {
            broadcastId: broadcast.id,
            ...(data ?? {}),
          } as Prisma.InputJsonValue,
          status: NotificationStatus.DISPATCHED,
          pushStatus: NotificationPushStatus.PENDING,
          dispatchedAt: new Date(),
        })),
      });
    }

    let push = {
      configured: this.firebaseMessaging.isConfigured(),
      deviceCount: 0,
      successCount: 0,
      failureCount: 0,
      invalidTokenCount: 0,
    };
    try {
      push = await this.firebaseMessaging.sendToUsers(
        users.map((user) => user.id),
        {
          notificationType: "admin.global",
          title,
          body,
          data: { broadcastId: broadcast.id, ...(data ?? {}) },
        },
        { throwOnTransientFailure: false },
      );
    } catch (error) {
      this.logger.warn(`Global FCM broadcast failed: ${String(error)}`);
      push = { ...push, failureCount: 1 };
    }
    await this.prisma.notificationBroadcast.update({
      where: { id: broadcast.id },
      data: {
        pushSentCount: push.successCount,
        pushFailedCount: push.failureCount,
      },
    });
    await this.prisma.notification.updateMany({
      where: { broadcastId: broadcast.id },
      data: {
        pushStatus: !push.configured
          ? NotificationPushStatus.SKIPPED
          : push.failureCount
            ? NotificationPushStatus.FAILED
            : NotificationPushStatus.SENT,
        pushAttemptedAt: new Date(),
        pushFailureReason: push.failureCount
          ? `${push.failureCount} device deliveries failed`
          : null,
      },
    });
    return this.serialize({
      broadcastId: broadcast.id,
      recipientCount: users.length,
      push,
    });
  }

  private async processOutbox() {
    if (this.processing) return;
    this.processing = true;
    try {
      for (let count = 0; count < 25; count += 1) {
        const event = await this.claimOne();
        if (!event) break;
        try {
          await this.deliver(event);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: OutboxEventStatus.PUBLISHED,
              processedAt: new Date(),
              lastError: null,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Notification delivery failed";
          this.logger.error(`Outbox event ${event.id} failed: ${message}`);
          await this.prisma.outboxEvent
            .update({
              where: { id: event.id },
              data: {
                status: OutboxEventStatus.FAILED,
                availableAt: new Date(Date.now() + 30000),
                lastError: message,
              },
            })
            .catch(() => undefined);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async claimOne() {
    return this.prisma.$transaction(async (transaction) => {
      const ids = await transaction.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "OutboxEvent" WHERE "status" IN ('PENDING', 'FAILED') AND "availableAt" <= CURRENT_TIMESTAMP ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!ids.length) return null;
      return transaction.outboxEvent.update({
        where: { id: ids[0].id },
        data: {
          status: OutboxEventStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });
    });
  }

  private async deliver(event: {
    id: string;
    eventType: string;
    aggregateId: string;
    payload: Prisma.JsonValue;
  }) {
    const payload = (
      event.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload)
        ? event.payload
        : {}
    ) as Record<string, Prisma.JsonValue>;
    const userIds = new Set<string>();
    if (typeof payload.userId === "string") userIds.add(payload.userId);
    if (event.eventType === "MATCH_SETTLED" && Array.isArray(payload.results)) {
      for (const result of payload.results) {
        if (result && typeof result === "object" && !Array.isArray(result)) {
          const playerId = (result as Record<string, Prisma.JsonValue>).playerId;
          const participantType = (result as Record<string, Prisma.JsonValue>).participantType;
          if (typeof playerId === "string" && participantType !== "BOT") userIds.add(playerId);
        }
      }
    }
    // `recipientUserId` identifies the recipient on gift events. Transfer
    // events have separate sent/received outbox records, so do not leak the
    // sender's notification to the recipient a second time.
    if (
      typeof payload.recipientUserId === "string" &&
      event.eventType === "gift.received"
    )
      userIds.add(payload.recipientUserId);
    if (event.eventType === "commerce.purchase.completed") {
      const admins = await this.prisma.user.findMany({
        where: { isSystemAdmin: true, status: "ACTIVE" },
        select: { id: true },
        take: 100,
      });
      admins.forEach((admin) => userIds.add(admin.id));
    }
    if (!userIds.size) return;
    const title =
      event.eventType === "wallet.gld.updated"
        ? "GLD balance updated"
        : event.eventType === "MATCH_SETTLED"
          ? "Match complete"
          : event.eventType === "commerce.purchase.completed"
        ? "Purchase completed"
        : event.eventType === "commerce.paid-reward.fulfilled"
          ? "Reward fulfilled"
          : event.eventType === "commerce.paid-reward.refused"
            ? "Reward request refused"
            : event.eventType === "ad-reward.granted"
              ? "Ad reward granted"
              : event.eventType === "leaderboard.reward.granted"
                ? "Leaderboard reward earned"
                : event.eventType === "gift.received"
                  ? "Gift received"
                  : event.eventType === "gift.sent"
                    ? "Gift sent"
                    : event.eventType === "gld.transfer.sent"
                      ? "GLD sent"
                      : event.eventType === "gld.transfer.received"
                        ? "GLD received"
                        : event.eventType === "referral.rewarded"
                          ? "Referral reward earned"
                          : event.eventType === "referral.joined"
                            ? "Referral joined"
                            : event.eventType ===
                                "matchmaking.friend-invite.created"
                              ? "Game invite"
                              : "Account activity";
    const body =
      event.eventType === "wallet.gld.updated"
        ? `Your GLD balance was ${String(payload.direction ?? "updated").toLowerCase()} by ${String(payload.amount ?? "0")} GLD. New balance: ${String(payload.balanceAfter ?? "0")} GLD.`
        : event.eventType === "MATCH_SETTLED"
          ? "Your match result and rewards are ready to review."
          : event.eventType === "commerce.purchase.completed"
        ? `Purchase ${event.aggregateId} was completed.`
        : event.eventType === "commerce.paid-reward.fulfilled"
          ? "Your paid reward was approved and is ready to redeem."
          : event.eventType === "commerce.paid-reward.refused"
            ? "Your paid reward request was refused and its GLD was refunded."
            : event.eventType === "ad-reward.granted"
              ? "Your rewarded ad credit is now available."
              : event.eventType === "leaderboard.reward.granted"
                ? `You placed #${String(payload.rank ?? "")} and earned a leaderboard reward.`
                : event.eventType === "gift.received"
                  ? `${String(payload.senderName ?? "A player")} sent you ${String(payload.socialGiftName ?? payload.catalogItemName ?? "a gift")}. ${String(payload.recipientAmount ?? "0")} GLD was credited to your wallet.`
                  : event.eventType === "gift.sent"
                    ? `Your ${String(payload.socialGiftName ?? payload.catalogItemName ?? "gift")} was sent to ${String(payload.recipientName ?? "another player")}.`
                    : event.eventType === "gld.transfer.sent"
                      ? `You sent ${String(payload.amount ?? "0")} GLD to ${String(payload.recipientName ?? "another player")}.`
                      : event.eventType === "gld.transfer.received"
                        ? `${String(payload.senderName ?? "A player")} sent you ${String(payload.amount ?? "0")} GLD.`
                        : event.eventType === "referral.rewarded"
                          ? `You earned ${String(payload.amount ?? "0")} GLD from your referral's verified ad reward.`
                          : event.eventType === "referral.joined"
                            ? payload.referralRole === "referred"
                              ? "Your account is now linked to a referral."
                              : "A player joined using your referral code."
                            : event.eventType ===
                                "matchmaking.friend-invite.created"
                              ? `${String(payload.inviterName ?? "A friend")} invited you to play ${String(payload.gameName ?? "a game")}.`
                              : "A server event was processed for your account.";
    await this.prisma.notification.createMany({
      data: [...userIds].map((userId) => ({
        userId,
        outboxEventId: event.id,
        notificationType: event.eventType,
        title,
        body,
        data: { ...payload, outboxEventId: event.id } as Prisma.InputJsonValue,
        status: NotificationStatus.DISPATCHED,
        pushStatus: NotificationPushStatus.PENDING,
        dispatchedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    const pushBody = this.pushBody(event.eventType, body);
    let push = {
      configured: this.firebaseMessaging.isConfigured(),
      deviceCount: 0,
      successCount: 0,
      failureCount: 0,
      invalidTokenCount: 0,
    };
    try {
      push = await this.firebaseMessaging.sendToUsers(
        [...userIds],
        {
          notificationId: event.id,
          notificationType: event.eventType,
          title,
          body: pushBody,
        },
        { throwOnTransientFailure: false },
      );
    } catch (error) {
      this.logger.warn(`Specific FCM notification failed: ${String(error)}`);
      push = { ...push, failureCount: 1 };
    }
    await this.prisma.notification.updateMany({
      where: { outboxEventId: event.id, userId: { in: [...userIds] } },
      data: {
        pushStatus: !push.configured
          ? NotificationPushStatus.SKIPPED
          : push.failureCount
            ? NotificationPushStatus.FAILED
            : NotificationPushStatus.SENT,
        pushAttemptedAt: new Date(),
        pushFailureReason: push.failureCount
          ? `${push.failureCount} device deliveries failed`
          : null,
      },
    });
  }

  private pushBody(eventType: string, body: string) {
    if (
      eventType.startsWith("gld.") ||
      eventType.startsWith("commerce.") ||
      eventType.startsWith("wallet.")
    ) {
      return "You have a new account update. Tap to view it.";
    }
    return body;
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ) as T;
  }
}
