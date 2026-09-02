import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { NotificationStatus, OutboxEventStatus, Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name)
  private timer?: NodeJS.Timeout
  private processing = false

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.processOutbox() }, 5000)
    this.timer.unref?.()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async listForUser(userId: string) {
    const items = await this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 })
    return this.serialize(items)
  }

  async markRead(userId: string, id: string) {
    const item = await this.prisma.notification.updateMany({ where: { id, userId, status: { not: NotificationStatus.READ } }, data: { status: NotificationStatus.READ, readAt: new Date() } })
    return { updated: item.count > 0 }
  }

  private async processOutbox() {
    if (this.processing) return
    this.processing = true
    try {
      for (let count = 0; count < 25; count += 1) {
        const event = await this.claimOne()
        if (!event) break
        try {
          await this.deliver(event)
          await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxEventStatus.PUBLISHED, processedAt: new Date(), lastError: null } })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Notification delivery failed"
          this.logger.error(`Outbox event ${event.id} failed: ${message}`)
          await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxEventStatus.FAILED, availableAt: new Date(Date.now() + 30000), lastError: message } }).catch(() => undefined)
        }
      }
    } finally { this.processing = false }
  }

  private async claimOne() {
    return this.prisma.$transaction(async (transaction) => {
      const ids = await transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "OutboxEvent" WHERE "status" IN ('PENDING', 'FAILED') AND "availableAt" <= CURRENT_TIMESTAMP ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`
      if (!ids.length) return null
      return transaction.outboxEvent.update({ where: { id: ids[0].id }, data: { status: OutboxEventStatus.PROCESSING, attempts: { increment: 1 } } })
    })
  }

  private async deliver(event: { id: string; eventType: string; aggregateId: string; payload: Prisma.JsonValue }) {
    const payload = (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {}) as Record<string, Prisma.JsonValue>
    const userIds = new Set<string>()
    if (typeof payload.userId === "string") userIds.add(payload.userId)
    if (event.eventType === "commerce.purchase.completed") {
      const admins = await this.prisma.user.findMany({ where: { isSystemAdmin: true, status: "ACTIVE" }, select: { id: true }, take: 100 })
      admins.forEach((admin) => userIds.add(admin.id))
    }
    if (!userIds.size) return
    const title = event.eventType === "commerce.purchase.completed" ? "Purchase completed" : event.eventType === "ad-reward.granted" ? "Ad reward granted" : "Account activity"
    const body = event.eventType === "commerce.purchase.completed" ? `Purchase ${event.aggregateId} was completed.` : event.eventType === "ad-reward.granted" ? "Your rewarded ad credit is now available." : "A server event was processed for your account."
    await this.prisma.notification.createMany({ data: [...userIds].map((userId) => ({ userId, outboxEventId: event.id, notificationType: event.eventType, title, body, data: { ...payload, outboxEventId: event.id } as Prisma.InputJsonValue, status: NotificationStatus.DISPATCHED, dispatchedAt: new Date() })), skipDuplicates: true })
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
