import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import { Prisma, SupportAgentLevel, SupportAgentStatus, SupportMessageSenderKind, SupportTicketPriority, SupportTicketStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { NotificationsService } from "../notifications/notifications.service"
import { CreateSupportCategoryDto, CreateSupportTicketDto, GrantSupportAgentDto, SupportAgentStatusDtoClass, SupportListQueryDto, SupportPriorityDto, SupportStatusDto, SupportTicketMessageDto, SupportTicketStatusUpdateDto, UpdateSupportAgentDto, UpdateSupportCategoryDto, UpdateSupportConfigurationDto } from "./dtos"

const PLAYER_VISIBLE_STATUSES = [SupportTicketStatus.OPEN, SupportTicketStatus.TRIAGED, SupportTicketStatus.ASSIGNED, SupportTicketStatus.WAITING_FOR_PLAYER, SupportTicketStatus.WAITING_FOR_SUPPORT, SupportTicketStatus.ESCALATED, SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED, SupportTicketStatus.REOPENED]
const ACTIVE_AGENT_TICKET_STATUSES = [SupportTicketStatus.ASSIGNED, SupportTicketStatus.WAITING_FOR_SUPPORT, SupportTicketStatus.REOPENED, SupportTicketStatus.ESCALATED]

@Injectable()
export class SupportService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async onModuleInit() {
    await this.prisma.supportConfiguration.upsert({ where: { key: "default" }, create: {}, update: {} }).catch(() => undefined)
    const categories = [
      ["ACCOUNT_LOGIN", "Account & login", "Sign-in, sessions, and account access."],
      ["MATCHMAKING_GAMEPLAY", "Matchmaking & gameplay", "Matches, game rules, and gameplay issues."],
      ["RESULT_REWARD", "Results & rewards", "Match results, XP, and rewards."],
      ["GLD", "GLD wallet", "Wallet balance and GLD transactions."],
      ["SOCIAL", "Friends & social", "Friends, gifts, and chat notifications."],
      ["STORE", "Store & purchases", "Purchases, inventory, and store items."],
      ["BUG", "Report a bug", "Something is not working as expected."],
      ["SAFETY", "Safety & harassment", "Safety, abuse, and player reports."],
      ["OTHER", "Other", "Anything else about SMARTS."],
    ] as const
    for (let index = 0; index < categories.length; index += 1) {
      const [key, name, description] = categories[index]
      await this.prisma.supportCategory.upsert({ where: { key }, create: { key, name, description, sortOrder: (index + 1) * 10 }, update: {} }).catch(() => undefined)
    }
  }

  async getConfiguration() {
    const config = await this.prisma.supportConfiguration.findUnique({ where: { key: "default" } })
    return this.serializeConfig(config ?? await this.prisma.supportConfiguration.create({ data: {} }))
  }

  async getPublicSummary(userId: string) {
    const [config, categories, openCount, unreadCount, agent] = await Promise.all([
      this.getConfiguration(),
      this.listCategories(),
      this.prisma.supportTicket.count({ where: { playerId: userId, status: { in: PLAYER_VISIBLE_STATUSES.filter((status) => status !== SupportTicketStatus.CLOSED) } } }),
      this.unreadCount(userId),
      this.prisma.supportAgent.findUnique({ where: { userId }, select: { id: true, level: true, status: true, revokedAt: true } }),
    ])
    return { enabled: config.enabled, maintenanceMessage: config.maintenanceMessage, categories, openTicketCount: openCount, unreadTicketCount: unreadCount, canWorkTickets: Boolean(agent && !agent.revokedAt && agent.status !== SupportAgentStatus.SUSPENDED), agent: agent && !agent.revokedAt ? { id: agent.id, level: agent.level, status: agent.status } : null }
  }

  async listCategories(includeInactive = false) {
    return this.prisma.supportCategory.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })
  }

  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    const config = await this.getConfiguration()
    if (!config.enabled) throw new ForbiddenException(config.maintenanceMessage || "Support tickets are temporarily unavailable")
    const category = await this.prisma.supportCategory.findFirst({ where: { id: dto.categoryId, active: true } })
    if (!category) throw new BadRequestException("Choose an active support category")
    const openCount = await this.prisma.supportTicket.count({ where: { playerId: userId, status: { notIn: [SupportTicketStatus.CLOSED, SupportTicketStatus.RESOLVED] } } })
    if (openCount >= config.maxOpenTicketsPerPlayer) throw new ConflictException(`You can have up to ${config.maxOpenTicketsPerPlayer} open support tickets`)
    const subject = dto.subject.trim().slice(0, config.maxSubjectLength)
    const body = dto.body.trim().slice(0, config.maxMessageLength)
    if (!subject || !body) throw new BadRequestException("Subject and message are required")
    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({ data: { ticketNumber: this.ticketNumber(), playerId: userId, categoryId: category.id, subject, priority: category.defaultPriority, lastSequence: 1 } })
      await tx.supportTicketMessage.create({ data: { ticketId: created.id, senderId: userId, senderKind: SupportMessageSenderKind.PLAYER, sequence: 1, clientMessageId: dto.clientMessageId, body } })
      await tx.supportTicketEvent.create({ data: { ticketId: created.id, actorId: userId, action: "CREATED", toStatus: SupportTicketStatus.OPEN } })
      await tx.supportAuditEvent.create({ data: { actorId: userId, ticketId: created.id, action: "TICKET_CREATED", metadata: { category: category.key } } })
      return created
    })
    await this.notifyAgents(ticket.id, "New support ticket", `${subject} needs a response.`, "support.ticket.created", config.pushNotificationsEnabled)
    return this.getTicket(userId, ticket.id)
  }

  async listPlayerTickets(userId: string, query: SupportListQueryDto) {
    const rows = await this.prisma.supportTicket.findMany({ where: { playerId: userId, ...(query.status ? { status: query.status as SupportTicketStatus } : {}) }, include: { category: true, assignedAgent: { include: { user: { select: { username: true, firstName: true, lastName: true } } } }, messages: { orderBy: { sequence: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: query.limit, skip: query.offset })
    const reads = await this.prisma.supportTicketRead.findMany({ where: { userId, ticketId: { in: rows.map((row) => row.id) } } })
    const readMap = new Map(reads.map((read) => [read.ticketId, read.lastSequence]))
    return rows.map((row) => this.serializeTicket(row, readMap.get(row.id) ?? 0))
  }

  async getTicket(userId: string, ticketId: string, internal = false) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, include: { category: true, player: { select: { id: true, username: true, firstName: true, lastName: true } }, assignedAgent: { include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } }, messages: { where: internal ? undefined : { internal: false }, orderBy: { sequence: "asc" } }, events: { orderBy: { createdAt: "asc" }, select: { id: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true } } } })
    if (!ticket) throw new NotFoundException("Support ticket not found")
    const isOwner = ticket.playerId === userId
    const isAgent = await this.isActiveAgent(userId)
    const isAdmin = await this.isSystemAdmin(userId)
    if (!isOwner && !isAgent && !isAdmin) throw new ForbiddenException("You cannot access this support ticket")
    const read = await this.prisma.supportTicketRead.findUnique({ where: { ticketId_userId: { ticketId, userId } } })
    return this.serializeTicket(ticket, read?.lastSequence ?? 0, internal || isAgent || isAdmin)
  }

  async addPlayerMessage(userId: string, ticketId: string, dto: SupportTicketMessageDto) {
    const ticket = await this.assertTicketOwner(userId, ticketId)
    if (ticket.status === SupportTicketStatus.CLOSED) throw new ConflictException("This ticket is closed. Reopen it before replying")
    return this.addMessage(ticket, userId, SupportMessageSenderKind.PLAYER, dto, false)
  }

  async reopen(userId: string, ticketId: string) {
    const ticket = await this.assertTicketOwner(userId, ticketId)
    if (ticket.status !== SupportTicketStatus.RESOLVED && ticket.status !== SupportTicketStatus.CLOSED) return this.getTicket(userId, ticketId)
    await this.changeStatus(ticket, SupportTicketStatus.REOPENED, userId, "Player reopened ticket")
    return this.getTicket(userId, ticketId)
  }

  async markRead(userId: string, ticketId: string, sequence: number) {
    await this.getTicket(userId, ticketId)
    await this.prisma.supportTicketRead.upsert({ where: { ticketId_userId: { ticketId, userId } }, create: { ticketId, userId, lastSequence: sequence }, update: { lastSequence: sequence } })
    return { updated: true }
  }

  async agentMe(userId: string) {
    const agent = await this.requireAgent(userId)
    const activeTickets = await this.prisma.supportTicket.count({ where: { assignedAgentId: agent.id, status: { in: ACTIVE_AGENT_TICKET_STATUSES } } })
    return { id: agent.id, userId, level: agent.level, status: agent.status, maxConcurrentTickets: agent.maxConcurrentTickets, activeTickets, lastSeenAt: agent.lastSeenAt }
  }

  async updateAgentStatus(userId: string, dto: SupportAgentStatusDtoClass) {
    const agent = await this.requireAgent(userId)
    const updated = await this.prisma.supportAgent.update({ where: { id: agent.id }, data: { status: dto.status, lastSeenAt: new Date(), suspensionReason: dto.status === SupportAgentStatus.SUSPENDED ? agent.suspensionReason : null } })
    await this.audit(userId, "AGENT_STATUS_CHANGED", { status: dto.status })
    return { id: updated.id, status: updated.status, level: updated.level }
  }

  async agentQueue(userId: string, query: SupportListQueryDto) {
    await this.requireAgent(userId)
    const rows = await this.prisma.supportTicket.findMany({ where: { ...(query.status ? { status: query.status as SupportTicketStatus } : { status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.TRIAGED, SupportTicketStatus.REOPENED, SupportTicketStatus.WAITING_FOR_SUPPORT, SupportTicketStatus.ESCALATED] } }), ...(query.priority ? { priority: query.priority as SupportTicketPriority } : {}), ...(query.categoryId ? { categoryId: query.categoryId } : {}) }, include: { category: true, player: { select: { id: true, username: true, firstName: true, lastName: true } }, assignedAgent: { include: { user: { select: { username: true } } } }, messages: { orderBy: { sequence: "desc" }, take: 1 } }, orderBy: [{ priority: "desc" }, { updatedAt: "asc" }], take: query.limit, skip: query.offset })
    return rows.map((row) => this.serializeTicket(row, 0))
  }

  async claim(userId: string, ticketId: string) {
    const agent = await this.requireAgent(userId)
    const active = await this.prisma.supportTicket.count({ where: { assignedAgentId: agent.id, status: { in: ACTIVE_AGENT_TICKET_STATUSES } } })
    if (active >= agent.maxConcurrentTickets) throw new ConflictException("Your support queue is at capacity")
    const claimed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.supportTicket.updateMany({ where: { id: ticketId, assignedAgentId: null, status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.TRIAGED, SupportTicketStatus.REOPENED, SupportTicketStatus.WAITING_FOR_SUPPORT, SupportTicketStatus.ESCALATED] } }, data: { assignedAgentId: agent.id, status: SupportTicketStatus.ASSIGNED } })
      if (!update.count) throw new ConflictException("This ticket has already been claimed")
      await tx.supportTicketAssignment.create({ data: { ticketId, agentId: agent.id, assignedById: userId } })
      await tx.supportTicketEvent.create({ data: { ticketId, actorId: userId, action: "CLAIMED", fromStatus: SupportTicketStatus.OPEN, toStatus: SupportTicketStatus.ASSIGNED } })
      return tx.supportTicket.findUnique({ where: { id: ticketId } })
    })
    if (!claimed) throw new NotFoundException("Support ticket not found")
    await this.notifyTicketPlayer(claimed.id, "Support agent assigned", "A support agent is now reviewing your ticket.", "support.ticket.assigned")
    return this.getTicket(userId, ticketId, true)
  }

  async assign(adminId: string, ticketId: string, agentId: string, reason?: string) {
    await this.requireSystemAdmin(adminId)
    const agent = await this.prisma.supportAgent.findUnique({ where: { id: agentId } })
    if (!agent || agent.revokedAt || agent.status === SupportAgentStatus.SUSPENDED) throw new BadRequestException("Support agent is not active")
    const ticket = await this.getTicketRaw(ticketId)
    const updated = await this.prisma.$transaction(async (tx) => {
      if (ticket.assignedAgentId) await tx.supportTicketAssignment.updateMany({ where: { ticketId, unassignedAt: null }, data: { unassignedAt: new Date() } })
      const next = await tx.supportTicket.update({ where: { id: ticketId }, data: { assignedAgentId: agent.id, status: SupportTicketStatus.ASSIGNED } })
      await tx.supportTicketAssignment.create({ data: { ticketId, agentId: agent.id, assignedById: adminId, reason } })
      await tx.supportTicketEvent.create({ data: { ticketId, actorId: adminId, action: "ASSIGNED", fromStatus: ticket.status, toStatus: SupportTicketStatus.ASSIGNED, note: reason } })
      return next
    })
    await this.notifyTicketPlayer(updated.id, "Support ticket assigned", "A support specialist is reviewing your request.", "support.ticket.assigned")
    return this.getTicket(adminId, ticketId, true)
  }

  async addAgentMessage(userId: string, ticketId: string, dto: SupportTicketMessageDto, internal = false, admin = false) {
    const agent = admin ? null : await this.requireAgent(userId)
    const ticket = await this.getTicketRaw(ticketId)
    if (!admin && ticket.assignedAgentId !== agent!.id && agent!.level !== SupportAgentLevel.SUPERVISOR) throw new ForbiddenException("Claim this ticket before replying")
    return this.addMessage(ticket, userId, SupportMessageSenderKind.AGENT, dto, internal)
  }

  async updateTicketStatus(userId: string, ticketId: string, dto: SupportTicketStatusUpdateDto, admin = false) {
    if (admin) await this.requireSystemAdmin(userId)
    else {
      const agent = await this.requireAgent(userId)
      const ticket = await this.getTicketRaw(ticketId)
      if (ticket.assignedAgentId !== agent.id && agent.level !== SupportAgentLevel.SUPERVISOR) throw new ForbiddenException("You are not assigned to this ticket")
    }
    const ticket = await this.getTicketRaw(ticketId)
    await this.changeStatus(ticket, dto.status as SupportTicketStatus, userId, dto.note)
    await this.notifyTicketPlayer(ticketId, "Support ticket updated", `Your support ticket is now ${dto.status.toLowerCase().replaceAll("_", " ")}.`, "support.ticket.status.changed")
    return this.getTicket(userId, ticketId, true)
  }

  async adminListTickets(query: SupportListQueryDto) {
    const rows = await this.prisma.supportTicket.findMany({ where: { ...(query.status ? { status: query.status as SupportTicketStatus } : {}), ...(query.priority ? { priority: query.priority as SupportTicketPriority } : {}), ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.search ? { OR: [{ ticketNumber: { contains: query.search, mode: "insensitive" } }, { subject: { contains: query.search, mode: "insensitive" } }, { player: { username: { contains: query.search, mode: "insensitive" } } }] } : {}) }, include: { category: true, player: { select: { id: true, username: true, firstName: true, lastName: true } }, assignedAgent: { include: { user: { select: { id: true, username: true } } } }, messages: { orderBy: { sequence: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: query.limit, skip: query.offset })
    return rows.map((row) => this.serializeTicket(row, 0))
  }

  async updateConfiguration(adminId: string, dto: UpdateSupportConfigurationDto) {
    await this.requireSystemAdmin(adminId)
    const data: Prisma.SupportConfigurationUpdateInput = { ...dto, liveChatPriceGld: dto.liveChatPriceGld === undefined ? undefined : new Prisma.Decimal(dto.liveChatPriceGld), updatedBy: { connect: { id: adminId } } }
    return this.serializeConfig(await this.prisma.supportConfiguration.update({ where: { key: "default" }, data }))
  }

  async adminAgents() {
    return this.prisma.supportAgent.findMany({ include: { user: { select: { id: true, username: true, firstName: true, lastName: true, email: true, status: true } }, _count: { select: { assignedTickets: true } } }, orderBy: { updatedAt: "desc" } })
  }

  async grantAgent(adminId: string, dto: GrantSupportAgentDto) {
    await this.requireSystemAdmin(adminId)
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, status: true } })
    if (!user || user.status !== "ACTIVE") throw new BadRequestException("Active player not found")
    return this.prisma.supportAgent.upsert({ where: { userId: dto.userId }, create: { userId: dto.userId, level: (dto.level as SupportAgentLevel) ?? SupportAgentLevel.AGENT, maxConcurrentTickets: dto.maxConcurrentTickets ?? 10, grantedById: adminId }, update: { level: (dto.level as SupportAgentLevel) ?? undefined, maxConcurrentTickets: dto.maxConcurrentTickets ?? undefined, revokedAt: null, revokedById: null, status: SupportAgentStatus.OFFLINE, grantedById: adminId, grantedAt: new Date() }, include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } })
  }

  async updateAgent(adminId: string, agentId: string, dto: UpdateSupportAgentDto) {
    await this.requireSystemAdmin(adminId)
    return this.prisma.supportAgent.update({ where: { id: agentId }, data: { ...dto, level: dto.level as SupportAgentLevel | undefined, status: dto.status as SupportAgentStatus | undefined }, include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } })
  }

  async revokeAgent(adminId: string, agentId: string) {
    await this.requireSystemAdmin(adminId)
    return this.prisma.supportAgent.update({ where: { id: agentId }, data: { revokedAt: new Date(), revokedById: adminId, status: SupportAgentStatus.OFFLINE }, include: { user: { select: { username: true } } } })
  }

  async adminAudit(limit = 100) {
    return this.prisma.supportAuditEvent.findMany({ take: Math.min(Math.max(limit, 1), 200), orderBy: { createdAt: "desc" }, include: { actor: { select: { username: true } }, ticket: { select: { ticketNumber: true, subject: true } } } })
  }

  async createCategory(adminId: string, dto: CreateSupportCategoryDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCategory.create({ data: { ...dto, key: dto.key.trim().toUpperCase(), defaultPriority: dto.defaultPriority as SupportTicketPriority | undefined } }) }
  async updateCategory(adminId: string, id: string, dto: UpdateSupportCategoryDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCategory.update({ where: { id }, data: { ...dto, key: dto.key?.trim().toUpperCase(), defaultPriority: dto.defaultPriority as SupportTicketPriority | undefined } }) }

  private async addMessage(ticket: { id: string; playerId: string; assignedAgentId: string | null; status: SupportTicketStatus }, senderId: string, senderKind: SupportMessageSenderKind, dto: SupportTicketMessageDto, internal: boolean) {
    const existing = await this.prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, clientMessageId: dto.clientMessageId } })
    if (existing) return this.getTicket(senderId, ticket.id, senderKind === SupportMessageSenderKind.AGENT)
    const body = dto.body.trim()
    const config = await this.getConfiguration()
    if (!body || body.length > config.maxMessageLength) throw new BadRequestException(`Message must be between 1 and ${config.maxMessageLength} characters`)
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.supportTicket.update({ where: { id: ticket.id }, data: { lastSequence: { increment: 1 }, ...(senderKind === SupportMessageSenderKind.PLAYER ? { lastPlayerActivity: new Date(), status: ticket.status === SupportTicketStatus.RESOLVED ? SupportTicketStatus.REOPENED : SupportTicketStatus.WAITING_FOR_SUPPORT } : { lastAgentActivity: new Date(), firstResponseAt: { set: new Date() }, status: internal ? ticket.status : SupportTicketStatus.WAITING_FOR_PLAYER }) } })
      await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, senderId, senderKind, sequence: next.lastSequence, clientMessageId: dto.clientMessageId, body, internal } })
      await tx.supportTicketEvent.create({ data: { ticketId: ticket.id, actorId: senderId, action: internal ? "INTERNAL_NOTE_ADDED" : "MESSAGE_ADDED", fromStatus: ticket.status, toStatus: next.status } })
      return next
    })
    if (senderKind === SupportMessageSenderKind.PLAYER && ticket.assignedAgentId) await this.notifyAgent(ticket.assignedAgentId, ticket.id, "Player replied", body, "support.ticket.message.received")
    if (senderKind === SupportMessageSenderKind.AGENT && !internal) await this.notifyTicketPlayer(ticket.id, "Support replied", body, "support.ticket.message.received")
    return this.getTicket(senderId, ticket.id, senderKind === SupportMessageSenderKind.AGENT)
  }

  private async changeStatus(ticket: { id: string; status: SupportTicketStatus }, status: SupportTicketStatus, actorId: string, note?: string) {
    if (ticket.status === status) return
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { status, resolvedAt: status === SupportTicketStatus.RESOLVED ? new Date() : status === SupportTicketStatus.REOPENED ? null : undefined, closedAt: status === SupportTicketStatus.CLOSED ? new Date() : status === SupportTicketStatus.REOPENED ? null : undefined } })
      await tx.supportTicketEvent.create({ data: { ticketId: ticket.id, actorId, action: "STATUS_CHANGED", fromStatus: ticket.status, toStatus: status, note } })
      await tx.supportAuditEvent.create({ data: { actorId, ticketId: ticket.id, action: "STATUS_CHANGED", metadata: { from: ticket.status, to: status, note } } })
    })
  }

  private async notifyAgents(ticketId: string, title: string, body: string, type: string, enabled: boolean) {
    const agents = await this.prisma.supportAgent.findMany({ where: { revokedAt: null, status: { in: [SupportAgentStatus.AVAILABLE, SupportAgentStatus.BUSY] } }, select: { userId: true } })
    for (const agent of agents) await this.notifications.createSupportNotification({ recipientId: agent.userId, ticketId, notificationType: type, title, body, enabled, pushEnabled: enabled })
  }

  private async notifyAgent(agentId: string, ticketId: string, title: string, body: string, type: string) { const [agent, config] = await Promise.all([this.prisma.supportAgent.findUnique({ where: { id: agentId } }), this.getConfiguration()]); if (agent) await this.notifications.createSupportNotification({ recipientId: agent.userId, ticketId, notificationType: type, title, body, enabled: config.enabled, pushEnabled: config.pushNotificationsEnabled }) }
  private async notifyTicketPlayer(ticketId: string, title: string, body: string, type: string) { const [ticket, config] = await Promise.all([this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { playerId: true } }), this.getConfiguration()]); if (ticket) await this.notifications.createSupportNotification({ recipientId: ticket.playerId, ticketId, notificationType: type, title, body, enabled: config.enabled, pushEnabled: config.pushNotificationsEnabled }) }
  private async assertTicketOwner(userId: string, ticketId: string) { const ticket = await this.getTicketRaw(ticketId); if (ticket.playerId !== userId) throw new ForbiddenException("You do not own this support ticket"); return ticket }
  private async getTicketRaw(ticketId: string) { const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } }); if (!ticket) throw new NotFoundException("Support ticket not found"); return ticket }
  private async requireAgent(userId: string) { const agent = await this.prisma.supportAgent.findUnique({ where: { userId } }); if (!agent || agent.revokedAt || agent.status === SupportAgentStatus.SUSPENDED) throw new ForbiddenException("Support agent access is required"); return agent }
  private async isActiveAgent(userId: string) { const agent = await this.prisma.supportAgent.findUnique({ where: { userId }, select: { revokedAt: true, status: true } }); return Boolean(agent && !agent.revokedAt && agent.status !== SupportAgentStatus.SUSPENDED) }
  private async requireSystemAdmin(userId: string) { const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } }); if (!user?.isSystemAdmin) throw new ForbiddenException("System administrator access is required") }
  private async isSystemAdmin(userId: string) { const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } }); return Boolean(user?.isSystemAdmin) }
  private async audit(actorId: string, action: string, metadata: Prisma.InputJsonValue) { await this.prisma.supportAuditEvent.create({ data: { actorId, action, metadata } }) }
  private async unreadCount(userId: string) { const tickets = await this.prisma.supportTicket.findMany({ where: { playerId: userId, status: { not: SupportTicketStatus.CLOSED } }, select: { id: true, lastSequence: true } }); const reads = await this.prisma.supportTicketRead.findMany({ where: { userId, ticketId: { in: tickets.map((ticket) => ticket.id) } }, select: { ticketId: true, lastSequence: true } }); const map = new Map(reads.map((read) => [read.ticketId, read.lastSequence])); return tickets.filter((ticket) => ticket.lastSequence > (map.get(ticket.id) ?? 0)).length }
  private serializeConfig(config: any) { return { ...config, liveChatPriceGld: config.liveChatPriceGld?.toString() ?? "2" } }
  private serializeTicket(row: any, readSequence: number, includeInternal = false) { return { id: row.id, ticketNumber: row.ticketNumber, subject: row.subject, status: row.status, priority: row.priority, createdAt: row.createdAt, updatedAt: row.updatedAt, firstResponseAt: row.firstResponseAt, resolvedAt: row.resolvedAt, category: row.category, player: row.player ? { id: row.player.id, username: row.player.username, name: [row.player.firstName, row.player.lastName].filter(Boolean).join(" ") || row.player.username } : undefined, assignedAgent: row.assignedAgent ? { id: row.assignedAgent.id, username: row.assignedAgent.user?.username } : null, unread: (row.lastSequence ?? 0) > readSequence, lastMessage: row.messages?.[0] ? { id: row.messages[0].id, body: row.messages[0].body, senderKind: row.messages[0].senderKind, sequence: row.messages[0].sequence, createdAt: row.messages[0].createdAt } : null, messages: row.messages?.filter((message: any) => includeInternal || !message.internal).map((message: any) => ({ id: message.id, sequence: message.sequence, body: message.body, senderKind: message.senderKind, sender: message.sender ? { id: message.sender.id, username: message.sender.username, name: [message.sender.firstName, message.sender.lastName].filter(Boolean).join(" ") || message.sender.username } : null, internal: includeInternal ? message.internal : undefined, createdAt: message.createdAt })) ?? [], events: row.events ?? [] } }
  private ticketNumber() { return `SUP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}` }

  async runRetentionCleanup(adminId: string) {
    await this.requireSystemAdmin(adminId)
    const config = await this.getConfiguration()
    const cutoff = new Date(Date.now() - config.ticketRetentionDays * 86400000)
    const deleted = await this.prisma.supportTicket.deleteMany({ where: { status: SupportTicketStatus.CLOSED, updatedAt: { lt: cutoff } } })
    await this.audit(adminId, "RETENTION_CLEANUP", { deletedTickets: deleted.count, cutoff: cutoff.toISOString() })
    return { deletedTickets: deleted.count, cutoff }
  }
}
