import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import { Prisma, SupportAgentLevel, SupportAgentStatus, SupportMessageSenderKind, SupportTicketPriority, SupportTicketStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { NotificationsService } from "../notifications/notifications.service"
import { CreateSupportArticleDto, CreateSupportCategoryDto, CreateSupportCannedReplyDto, CreateSupportTicketDto, GrantSupportAgentDto, SupportAgentStatusDtoClass, SupportArticleListQueryDto, SupportAttachmentPresignDto, SupportEscalateDto, SupportListQueryDto, SupportPriorityDto, SupportRatingDto, SupportStatusDto, SupportTicketMessageDto, SupportTicketStatusUpdateDto, UpdateSupportAgentDto, UpdateSupportCategoryDto, UpdateSupportConfigurationDto } from "./dtos"

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
    return { enabled: config.enabled, liveChatEnabled: config.liveChatEnabled, liveChatPriceGld: config.liveChatPriceGld.toString(), liveChatCurrencyCode: config.liveChatCurrencyCode, maintenanceMessage: config.maintenanceMessage, categories, openTicketCount: openCount, unreadTicketCount: unreadCount, canWorkTickets: Boolean(agent && !agent.revokedAt && agent.status !== SupportAgentStatus.SUSPENDED), canWorkLiveChats: Boolean(agent && !agent.revokedAt && agent.status !== SupportAgentStatus.SUSPENDED), agent: agent && !agent.revokedAt ? { id: agent.id, level: agent.level, status: agent.status } : null }
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
    const recentTickets = await this.prisma.supportTicket.count({ where: { playerId: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
    if (recentTickets >= config.playerTicketRatePerHour) throw new ConflictException("Support ticket rate limit reached; try again later")
    const subject = dto.subject.trim().slice(0, config.maxSubjectLength)
    const body = dto.body.trim().slice(0, config.maxMessageLength)
    if (!subject || !body) throw new BadRequestException("Subject and message are required")
    const ticket = await this.prisma.$transaction(async (tx) => {
      const createdAt = new Date()
      const created = await tx.supportTicket.create({ data: { ticketNumber: this.ticketNumber(), playerId: userId, categoryId: category.id, subject, customData: dto.customData as Prisma.InputJsonValue | undefined, priority: category.defaultPriority, lastSequence: 1, firstResponseDueAt: new Date(createdAt.getTime() + config.firstResponseSlaMinutes * 60000), resolutionDueAt: new Date(createdAt.getTime() + (config.firstResponseSlaMinutes + config.playerReplyTimeoutHours * 60) * 60000) } })
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
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, include: { category: true, player: { select: { id: true, username: true, firstName: true, lastName: true } }, assignedAgent: { include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } }, messages: { where: internal ? undefined : { internal: false }, orderBy: { sequence: "asc" } }, attachments: { where: { scanStatus: { not: "REJECTED" as any } }, orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" }, select: { id: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true } } } })
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
    const config = await this.prisma.supportConfiguration.findUniqueOrThrow({ where: { key: "default" } })
    if (ticket.updatedAt.getTime() < Date.now() - config.playerCanReopenDays * 86400000) throw new ConflictException("This ticket can no longer be reopened")
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
    return this.prisma.supportAgent.upsert({ where: { userId: dto.userId }, create: { userId: dto.userId, level: (dto.level as SupportAgentLevel) ?? SupportAgentLevel.AGENT, maxConcurrentTickets: dto.maxConcurrentTickets ?? 10, maxConcurrentLiveChats: dto.maxConcurrentLiveChats ?? 2, grantedById: adminId }, update: { level: (dto.level as SupportAgentLevel) ?? undefined, maxConcurrentTickets: dto.maxConcurrentTickets ?? undefined, maxConcurrentLiveChats: dto.maxConcurrentLiveChats ?? undefined, revokedAt: null, revokedById: null, status: SupportAgentStatus.OFFLINE, grantedById: adminId, grantedAt: new Date() }, include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } })
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

  async createCategory(adminId: string, dto: CreateSupportCategoryDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCategory.create({ data: { ...dto, key: dto.key.trim().toUpperCase(), defaultPriority: dto.defaultPriority as SupportTicketPriority | undefined, formSchema: dto.formSchema as Prisma.InputJsonValue | undefined } }) }
  async updateCategory(adminId: string, id: string, dto: UpdateSupportCategoryDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCategory.update({ where: { id }, data: { ...dto, key: dto.key?.trim().toUpperCase(), defaultPriority: dto.defaultPriority as SupportTicketPriority | undefined, formSchema: dto.formSchema as Prisma.InputJsonValue | undefined } }) }

  async listArticles(query: SupportArticleListQueryDto, includeDrafts = false) {
    const status = query.status ? query.status as any : includeDrafts ? undefined : "PUBLISHED"
    const term = query.query?.trim().toLowerCase()
    const rows = await this.prisma.supportHelpArticle.findMany({
      where: { ...(status ? { status } : {}), ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(term ? { searchText: { contains: term, mode: "insensitive" } } : {}) },
      include: { category: true }, orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { updatedAt: "desc" }], take: query.limit, skip: query.offset,
    })
    return rows.map((article) => this.serializeArticle(article, includeDrafts))
  }

  async getArticle(articleId: string, includeDrafts = false) {
    const article = await this.prisma.supportHelpArticle.findUnique({ where: { id: articleId }, include: { category: true } })
    if (!article || (!includeDrafts && article.status !== "PUBLISHED")) throw new NotFoundException("Support article not found")
    if (!includeDrafts) await this.prisma.supportHelpArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } })
    return this.serializeArticle(article, includeDrafts)
  }

  async articleFeedback(articleId: string, helpful: boolean) {
    const article = await this.prisma.supportHelpArticle.findUnique({ where: { id: articleId }, select: { id: true, status: true } })
    if (!article || article.status !== "PUBLISHED") throw new NotFoundException("Support article not found")
    await this.prisma.supportHelpArticle.update({ where: { id: articleId }, data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } } })
    return { recorded: true }
  }

  async adminArticles(query: SupportArticleListQueryDto) { return this.listArticles(query, true) }

  async createArticle(adminId: string, dto: CreateSupportArticleDto) {
    await this.requireSystemAdmin(adminId)
    const status = (dto.status ?? "DRAFT") as any
    const now = status === "PUBLISHED" ? new Date() : null
    return this.prisma.supportHelpArticle.create({ data: { slug: dto.slug.trim().toLowerCase(), title: dto.title.trim(), summary: dto.summary.trim(), body: dto.body.trim(), searchText: `${dto.title} ${dto.summary} ${dto.body} ${dto.tags ?? ""}`.toLowerCase(), tags: dto.tags ? dto.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined, categoryId: dto.categoryId ?? null, status, sortOrder: dto.sortOrder ?? 0, publishedAt: now, createdById: adminId, updatedById: adminId }, include: { category: true } }).then((row) => this.serializeArticle(row, true))
  }

  async updateArticle(adminId: string, articleId: string, dto: CreateSupportArticleDto) {
    await this.requireSystemAdmin(adminId)
    const existing = await this.prisma.supportHelpArticle.findUnique({ where: { id: articleId } })
    if (!existing) throw new NotFoundException("Support article not found")
    const status = (dto.status ?? existing.status) as any
    return this.prisma.supportHelpArticle.update({ where: { id: articleId }, data: { slug: dto.slug.trim().toLowerCase(), title: dto.title.trim(), summary: dto.summary.trim(), body: dto.body.trim(), searchText: `${dto.title} ${dto.summary} ${dto.body} ${dto.tags ?? ""}`.toLowerCase(), tags: dto.tags ? dto.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined, categoryId: dto.categoryId ?? null, status, sortOrder: dto.sortOrder ?? existing.sortOrder, publishedAt: status === "PUBLISHED" ? existing.publishedAt ?? new Date() : null, updatedById: adminId }, include: { category: true } }).then((row) => this.serializeArticle(row, true))
  }

  async archiveArticle(adminId: string, articleId: string) { await this.requireSystemAdmin(adminId); return this.prisma.supportHelpArticle.update({ where: { id: articleId }, data: { status: "ARCHIVED" as any, updatedById: adminId } }) }

  async listCannedReplies(categoryId?: string, includeInactive = false) { return this.prisma.supportCannedReply.findMany({ where: { ...(includeInactive ? {} : { active: true }), ...(categoryId ? { OR: [{ categoryId }, { categoryId: null }] } : {}) }, include: { category: true }, orderBy: { title: "asc" } }) }
  async adminCannedReplies() { return this.listCannedReplies(undefined, true) }
  async createCannedReply(adminId: string, dto: CreateSupportCannedReplyDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCannedReply.create({ data: { key: dto.key.trim().toLowerCase(), title: dto.title.trim(), body: dto.body.trim(), categoryId: dto.categoryId ?? null, active: dto.active ?? true, createdById: adminId, updatedById: adminId }, include: { category: true } }) }
  async updateCannedReply(adminId: string, id: string, dto: CreateSupportCannedReplyDto) { await this.requireSystemAdmin(adminId); return this.prisma.supportCannedReply.update({ where: { id }, data: { key: dto.key.trim().toLowerCase(), title: dto.title.trim(), body: dto.body.trim(), categoryId: dto.categoryId ?? null, active: dto.active ?? true, updatedById: adminId }, include: { category: true } }) }

  async rateTicket(userId: string, ticketId: string, dto: SupportRatingDto) {
    const ticket = await this.assertTicketOwner(userId, ticketId)
    if (ticket.status !== SupportTicketStatus.RESOLVED && ticket.status !== SupportTicketStatus.CLOSED) throw new ConflictException("Rate a ticket after it is resolved")
    return this.prisma.supportTicketRating.upsert({ where: { ticketId_playerId: { ticketId, playerId: userId } }, create: { ticketId, playerId: userId, rating: dto.rating, comment: dto.comment?.trim() || null }, update: { rating: dto.rating, comment: dto.comment?.trim() || null } })
  }

  async escalateTicket(userId: string, ticketId: string, dto: SupportEscalateDto) {
    const ticket = await this.getTicketRaw(ticketId)
    const allowed = ticket.playerId === userId || await this.isActiveAgent(userId) || await this.isSystemAdmin(userId)
    if (!allowed) throw new ForbiddenException("You cannot escalate this ticket")
    if (ticket.status === SupportTicketStatus.CLOSED) throw new ConflictException("Closed tickets cannot be escalated")
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: SupportTicketStatus.ESCALATED, priority: SupportTicketPriority.HIGH } })
      await tx.supportTicketEscalation.create({ data: { ticketId, actorId: userId, reason: dto.reason.trim(), fromStatus: ticket.status } })
      await tx.supportTicketEvent.create({ data: { ticketId, actorId: userId, action: "ESCALATED", fromStatus: ticket.status, toStatus: SupportTicketStatus.ESCALATED, note: dto.reason.trim() } })
      await tx.supportAuditEvent.create({ data: { actorId: userId, ticketId, action: "TICKET_ESCALATED", metadata: { reason: dto.reason.trim() } } })
    })
    await this.notifyAgents(ticketId, "Ticket escalated", `${ticket.subject} needs supervisor attention.`, "support.ticket.escalated", true)
    return this.getTicket(userId, ticketId)
  }

  async presignAttachment(userId: string, dto: SupportAttachmentPresignDto) {
    const ticket = await this.assertTicketOwner(userId, dto.ticketId)
    if (ticket.status === SupportTicketStatus.CLOSED) throw new ConflictException("Closed tickets cannot receive attachments")
    const config = await this.prisma.supportConfiguration.findUniqueOrThrow({ where: { key: "default" } })
    if (dto.sizeBytes > config.maxAttachmentSizeBytes) throw new BadRequestException("Attachment is larger than the configured limit")
    const ext = dto.fileName.split(".").pop()?.toLowerCase() ?? ""
    const blocked = Array.isArray(config.blockedAttachmentExtensions) && config.blockedAttachmentExtensions.map(String).includes(ext)
    if (blocked) throw new BadRequestException("This file type is not allowed")
    if (Array.isArray(config.allowedAttachmentMimes) && config.allowedAttachmentMimes.length && !config.allowedAttachmentMimes.map(String).includes(dto.mimeType.toLowerCase())) throw new BadRequestException("This file type is not allowed")
    const count = await this.prisma.supportAttachment.count({ where: { ticketId: dto.ticketId, createdById: userId, scanStatus: { not: "EXPIRED" as any } } })
    if (count >= config.maxAttachmentsPerMessage) throw new ConflictException("Attachment limit reached")
    const storageKey = `support/${ticket.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${ext}`
    const row = await this.prisma.supportAttachment.create({ data: { ticketId: ticket.id, createdById: userId, fileName: dto.fileName.trim(), mimeType: dto.mimeType.toLowerCase(), sizeBytes: dto.sizeBytes, storageKey, expiresAt: new Date(Date.now() + config.attachmentRetentionDays * 86400000) } })
    return { attachmentId: row.id, storageKey: row.storageKey, uploadRequired: true, uploadEndpoint: `/support/tickets/${ticket.id}/attachments/${row.id}/upload`, scanStatus: row.scanStatus, expiresAt: row.expiresAt }
  }

  async completeAttachment(userId: string, ticketId: string, attachmentId: string, storageFileId: string) {
    const attachment = await this.prisma.supportAttachment.findUnique({ where: { id: attachmentId } })
    if (!attachment || attachment.ticketId !== ticketId || attachment.createdById !== userId) throw new NotFoundException("Support attachment not found")
    const file = await this.prisma.storedFile.findFirst({ where: { id: storageFileId, userId, status: "ACTIVE" as any } })
    if (!file) throw new BadRequestException("Uploaded support file was not found")
    return this.prisma.supportAttachment.update({ where: { id: attachment.id }, data: { storageKey: `stored:${file.id}`, scanStatus: "CLEAN" as any, scanReason: "Validated by the private image upload pipeline" } })
  }

  async attachmentFileId(userId: string, ticketId: string, attachmentId: string) {
    const ticket = await this.assertTicketOwner(userId, ticketId)
    const attachment = await this.prisma.supportAttachment.findFirst({ where: { id: attachmentId, ticketId: ticket.id, scanStatus: "CLEAN" as any } })
    const fileId = attachment?.storageKey.startsWith("stored:") ? attachment.storageKey.slice("stored:".length) : null
    if (!fileId) throw new NotFoundException("Support attachment is not available")
    return fileId
  }

  async supportReports(adminId: string, from?: string, to?: string) {
    await this.requireSystemAdmin(adminId)
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000)
    const end = to ? new Date(to) : new Date()
    const where = { createdAt: { gte: start, lte: end } }
    const [tickets, statuses, priorities, ratings, articles, chats, agents, overdue] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.supportTicket.groupBy({ by: ["priority"], where, _count: { _all: true } }),
      this.prisma.supportTicketRating.aggregate({ where: { createdAt: { gte: start, lte: end } }, _avg: { rating: true }, _count: { _all: true } }),
      this.prisma.supportHelpArticle.findMany({ orderBy: { viewCount: "desc" }, take: 10, select: { id: true, title: true, viewCount: true, helpfulYes: true, helpfulNo: true } }),
      this.prisma.supportLiveChatSession.count({ where: { createdAt: { gte: start, lte: end } } }),
      this.prisma.supportAgent.count({ where: { revokedAt: null } }),
      this.prisma.supportTicket.count({ where: { slaOverdue: true, status: { notIn: [SupportTicketStatus.CLOSED, SupportTicketStatus.RESOLVED] } } }),
    ])
    return { range: { from: start, to: end }, tickets, statuses, priorities, ratings: { average: ratings._avg.rating ?? 0, count: ratings._count._all }, liveChats: chats, activeAgents: agents, overdueTickets: overdue, topArticles: articles }
  }

  async exportSupportReport(adminId: string, from?: string, to?: string) {
    const report = await this.supportReports(adminId, from, to)
    const rows = ["metric,value", `tickets,${report.tickets}`, `overdue_tickets,${report.overdueTickets}`, `live_chats,${report.liveChats}`, `active_agents,${report.activeAgents}`, `average_rating,${report.ratings.average}`, `rating_count,${report.ratings.count}`]
    return { fileName: `support-report-${new Date().toISOString().slice(0, 10)}.csv`, contentType: "text/csv", content: rows.join("\n") }
  }

  private async addMessage(ticket: { id: string; playerId: string; assignedAgentId: string | null; status: SupportTicketStatus }, senderId: string, senderKind: SupportMessageSenderKind, dto: SupportTicketMessageDto, internal: boolean) {
    const existing = await this.prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, clientMessageId: dto.clientMessageId } })
    if (existing) return this.getTicket(senderId, ticket.id, senderKind === SupportMessageSenderKind.AGENT)
    const config = await this.getConfiguration()
    const recent = await this.prisma.supportTicketMessage.count({ where: { ticketId: ticket.id, senderId, createdAt: { gte: new Date(Date.now() - 60_000) } } })
    if (senderKind === SupportMessageSenderKind.AGENT && recent >= config.agentReplyRatePerMinute) throw new ConflictException("Reply rate limit reached")
    let body = dto.body.trim()
    if (config.profanityPolicy === "BLOCK" && this.hasBlockedWords(body)) throw new BadRequestException("Please remove abusive language before sending")
    if (config.profanityPolicy === "REDACT") body = this.redact(body)
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
  private serializeArticle(article: any, includeDrafts: boolean) { return { id: article.id, slug: article.slug, title: article.title, summary: article.summary, body: article.body, status: includeDrafts ? article.status : undefined, category: article.category, tags: article.tags ?? [], sortOrder: includeDrafts ? article.sortOrder : undefined, viewCount: includeDrafts ? article.viewCount : undefined, helpfulYes: includeDrafts ? article.helpfulYes : undefined, helpfulNo: includeDrafts ? article.helpfulNo : undefined, publishedAt: article.publishedAt, updatedAt: article.updatedAt } }
  private serializeTicket(row: any, readSequence: number, includeInternal = false) { return { id: row.id, ticketNumber: row.ticketNumber, subject: row.subject, status: row.status, priority: row.priority, createdAt: row.createdAt, updatedAt: row.updatedAt, firstResponseAt: row.firstResponseAt, resolvedAt: row.resolvedAt, slaOverdue: row.slaOverdue ?? false, category: row.category, player: row.player ? { id: row.player.id, username: row.player.username, name: [row.player.firstName, row.player.lastName].filter(Boolean).join(" ") || row.player.username } : undefined, assignedAgent: row.assignedAgent ? { id: row.assignedAgent.id, username: row.assignedAgent.user?.username } : null, unread: (row.lastSequence ?? 0) > readSequence, lastMessage: row.messages?.[0] ? { id: row.messages[0].id, body: row.messages[0].body, senderKind: row.messages[0].senderKind, sequence: row.messages[0].sequence, createdAt: row.messages[0].createdAt } : null, messages: row.messages?.filter((message: any) => includeInternal || !message.internal).map((message: any) => ({ id: message.id, sequence: message.sequence, body: message.body, senderKind: message.senderKind, sender: message.sender ? { id: message.sender.id, username: message.sender.username, name: [message.sender.firstName, message.sender.lastName].filter(Boolean).join(" ") || message.sender.username } : null, internal: includeInternal ? message.internal : undefined, createdAt: message.createdAt })) ?? [], attachments: row.attachments?.map((attachment: any) => ({ id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, scanStatus: attachment.scanStatus, expiresAt: attachment.expiresAt })) ?? [], events: row.events ?? [] } }
  private ticketNumber() { return `SUP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}` }
  private hasBlockedWords(value: string) { return /\b(fuck|shit|bitch|cunt|nigger|whore)\b/i.test(value) }
  private redact(value: string) { return value.replace(/\b(fuck|shit|bitch|cunt|nigger|whore)\b/gi, "•••") }

  async runRetentionCleanup(adminId: string) {
    await this.requireSystemAdmin(adminId)
    const config = await this.getConfiguration()
    const cutoff = new Date(Date.now() - config.ticketRetentionDays * 86400000)
    const deleted = await this.prisma.supportTicket.deleteMany({ where: { status: SupportTicketStatus.CLOSED, updatedAt: { lt: cutoff } } })
    await this.audit(adminId, "RETENTION_CLEANUP", { deletedTickets: deleted.count, cutoff: cutoff.toISOString() })
    return { deletedTickets: deleted.count, cutoff }
  }
}
