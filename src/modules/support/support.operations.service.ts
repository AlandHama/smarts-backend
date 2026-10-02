import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { SupportAgentStatus, SupportLiveChatStatus, SupportTicketStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { NotificationsService } from "../notifications/notifications.service"
import { SupportLiveChatService } from "./support-live-chat.service"
import { SupportService } from "./support.service"

/** Server-authoritative housekeeping for SLA, queue safety, and retention. */
@Injectable()
export class SupportOperationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private running = false

  constructor(private readonly prisma: PrismaService, private readonly support: SupportService, private readonly liveChat: SupportLiveChatService, private readonly notifications: NotificationsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run().catch(() => undefined), 60_000)
    void this.run().catch(() => undefined)
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async run() {
    if (this.running) return { skipped: true }
    this.running = true
    try {
      const [config, admin] = await Promise.all([
        this.prisma.supportConfiguration.findUnique({ where: { key: "default" } }),
        this.prisma.user.findFirst({ where: { isSystemAdmin: true, status: "ACTIVE" }, select: { id: true } }),
      ])
      if (!config || !admin) return { skipped: true }
      const result = { overdue: 0, closedLiveChats: 0, refundedLiveChats: 0, deletedAttachments: 0 }
      if (config.slaWorkerEnabled) result.overdue = await this.processSla(config.pushNotificationsEnabled, admin.id)
      const inactiveBefore = new Date(Date.now() - config.autoCloseInactiveMinutes * 60_000)
      const inactive = await this.prisma.supportLiveChatSession.findMany({ where: { status: { in: [SupportLiveChatStatus.ASSIGNED, SupportLiveChatStatus.ACTIVE, SupportLiveChatStatus.PAUSED, SupportLiveChatStatus.WAITING_FOR_PLAYER] }, lastActivityAt: { lt: inactiveBefore } }, select: { id: true } })
      for (const session of inactive) { try { await this.liveChat.updateStatus(admin.id, session.id, { status: "ENDED" } as any, true); result.closedLiveChats += 1 } catch (_) { /* another worker completed it */ } }
      try { result.refundedLiveChats = (await this.liveChat.runNoAgentRefunds(admin.id)).refunded } catch (_) { /* keep housekeeping resilient */ }
      const expired = await this.prisma.supportAttachment.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      result.deletedAttachments = expired.count
      if (new Date().getUTCMinutes() === 0) await this.support.runRetentionCleanup(admin.id).catch(() => undefined)
      return result
    } finally { this.running = false }
  }

  private async processSla(pushEnabled: boolean, systemAdminId: string) {
    const now = new Date()
    const rows = await this.prisma.supportTicket.findMany({ where: { status: { notIn: [SupportTicketStatus.CLOSED, SupportTicketStatus.RESOLVED] }, OR: [{ firstResponseAt: null, firstResponseDueAt: { lt: now } }, { resolutionDueAt: { lt: now } }] }, include: { assignedAgent: true }, take: 100 })
    for (const ticket of rows) {
      const shouldNotify = !ticket.lastSlaNotifiedAt || ticket.lastSlaNotifiedAt.getTime() < Date.now() - 6 * 60 * 60 * 1000
      const resolutionOverdue = Boolean(ticket.resolutionDueAt && ticket.resolutionDueAt < now)
      await this.prisma.supportTicket.update({ where: { id: ticket.id }, data: { slaOverdue: true, lastSlaNotifiedAt: shouldNotify ? now : ticket.lastSlaNotifiedAt, ...(resolutionOverdue && ticket.status !== SupportTicketStatus.ESCALATED ? { status: SupportTicketStatus.ESCALATED, priority: "HIGH" as any } : {}) } })
      if (resolutionOverdue && ticket.status !== SupportTicketStatus.ESCALATED) await this.prisma.$transaction([
        this.prisma.supportTicketEscalation.create({ data: { ticketId: ticket.id, actorId: systemAdminId, reason: "Automatic SLA escalation: resolution deadline exceeded", fromStatus: ticket.status } }),
        this.prisma.supportTicketEvent.create({ data: { ticketId: ticket.id, actorId: systemAdminId, action: "SLA_ESCALATED", fromStatus: ticket.status, toStatus: SupportTicketStatus.ESCALATED } }),
      ])
      if (shouldNotify) {
        const recipients = ticket.assignedAgent ? [ticket.assignedAgent.userId] : (await this.prisma.supportAgent.findMany({ where: { revokedAt: null, level: "SUPERVISOR" as any, status: { in: [SupportAgentStatus.AVAILABLE, SupportAgentStatus.BUSY] } }, select: { userId: true } })).map((agent) => agent.userId)
        for (const recipientId of recipients) await this.notifications.createSupportNotification({ recipientId, ticketId: ticket.id, notificationType: "support.ticket.sla.overdue", title: "Support SLA overdue", body: `${ticket.ticketNumber} needs attention.`, enabled: true, pushEnabled })
        await this.prisma.supportAuditEvent.create({ data: { ticketId: ticket.id, action: "SLA_OVERDUE", metadata: { notified: recipients.length > 0 } } })
      }
    }
    return rows.length
  }
}
