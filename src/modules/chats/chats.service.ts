import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common"
import { ChatConversationType, ChatMessageState, ChatParticipantRole, Prisma, UserStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { NotificationsService } from "../notifications/notifications.service"
import { ChatPresenceRegistry } from "./chat-presence.registry"
import {
  AdminChatMessagesQueryDto,
  AdminChatReportQueryDto,
  AdminChatsQueryDto,
  AdminChatStatusDto,
  AdminChatRestrictionDto,
  AdminChatUnrestrictionDto,
  AdminMuteChatDto,
  AdminPreserveChatEvidenceDto,
  AdminRemoveChatMessageDto,
  AdminResolveChatReportDto,
  ReportChatMessageDto,
  UpdateChatConfigurationDto,
} from "./dtos"

const DEFAULT_CONFIG = {
  key: "default",
  enabled: true,
  retentionDays: 7,
  maxMessageLength: 1000,
  maxMessagesPerMinute: 20,
  maxMessagesPerDay: 500,
  typingEnabled: true,
  readReceiptsEnabled: true,
  pushNotificationsEnabled: true,
  includeMessagePreview: false,
  friendChatOnly: true,
  allowLinks: false,
  maintenanceMessage: null,
} as const

const publicUserSelect = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} satisfies Prisma.UserSelect

const adminUserSelect = {
  ...publicUserSelect,
  lastOnline: true,
} satisfies Prisma.UserSelect

type Config = Prisma.ChatConfigurationGetPayload<{}>

@Injectable()
export class ChatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatsService.name)
  private cleanupTimer?: NodeJS.Timeout

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly chatPresence: ChatPresenceRegistry,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => void this.cleanupExpiredMessages(), 15 * 60 * 1000)
    this.cleanupTimer.unref?.()
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }

  async getConfiguration() {
    return this.serializeConfig(await this.ensureConfiguration())
  }

  async updateConfiguration(dto: UpdateChatConfigurationDto, adminId: string) {
    const config = await this.prisma.chatConfiguration.upsert({
      where: { key: DEFAULT_CONFIG.key },
      create: { ...DEFAULT_CONFIG, ...(dto as Prisma.ChatConfigurationCreateInput) },
      update: dto as Prisma.ChatConfigurationUpdateInput,
    })
    await this.prisma.adminAuditEvent.create({
      data: {
        actorId: adminId,
        action: "CHAT_CONFIGURATION_UPDATED",
        entityType: "ChatConfiguration",
        entityId: config.id,
        reason: "System administrator updated friend chat configuration",
        metadata: dto as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)
    return this.serializeConfig(config)
  }

  async getPublicConfiguration(userId?: string) {
    const config = await this.ensureConfiguration()
    const restriction = userId ? await this.prisma.chatRestriction.findFirst({ where: { userId, revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] }, orderBy: { createdAt: "desc" }, select: { restrictedUntil: true } }) : null
    return {
      enabled: config.enabled,
      retentionDays: config.retentionDays,
      maxMessageLength: config.maxMessageLength,
      typingEnabled: config.typingEnabled,
      readReceiptsEnabled: config.readReceiptsEnabled,
      pushNotificationsEnabled: config.pushNotificationsEnabled,
      includeMessagePreview: config.includeMessagePreview,
      friendChatOnly: config.friendChatOnly,
      maintenanceMessage: config.maintenanceMessage,
      restricted: Boolean(restriction),
      restrictionUntil: restriction?.restrictedUntil?.toISOString() ?? null,
    }
  }

  /** Authorizes a socket subscription against the current friendship state. */
  async authorizeConversation(userId: string, conversationId: string) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const config = await this.ensureConfiguration()
    return {
      conversationId,
      retentionDays: config.retentionDays,
      participantIds: participant.conversation.participants.map((row) => row.userId),
    }
  }

  async authorizeFriendPresence(userId: string, friendId: string) {
    await this.assertChatAvailable(userId, friendId)
    return { userId: friendId }
  }

  async participantIds(conversationId: string) {
    const rows = await this.prisma.chatParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    })
    return rows.map((row) => row.userId)
  }

  async listConversations(userId: string, limit: number, cursor?: string) {
    const config = await this.ensureConfiguration()
    const restriction = await this.prisma.chatRestriction.findFirst({ where: { userId, revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] }, orderBy: { createdAt: "desc" }, select: { restrictedUntil: true } })
    const rows = await this.prisma.chatParticipant.findMany({
      where: { userId },
      orderBy: [{ conversation: { lastMessageAt: "desc" } }, { joinedAt: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: publicUserSelect } } },
            messages: {
              where: { moderationState: { in: [ChatMessageState.VISIBLE, ChatMessageState.FLAGGED] }, expiresAt: { gt: new Date() } },
              orderBy: { sequence: "desc" },
              take: 1,
            },
          },
        },
      },
    })
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const conversations = await Promise.all(page.map(async (row) => {
      const other = row.conversation.type === ChatConversationType.DIRECT_FRIEND ? row.conversation.participants.find((participant) => participant.userId !== userId) : undefined
      const unreadCount = await this.prisma.chatMessage.count({
        where: {
          conversationId: row.conversationId,
          sequence: { gt: row.lastReadSequence },
          senderId: { not: userId },
          moderationState: { in: [ChatMessageState.VISIBLE, ChatMessageState.FLAGGED] },
          expiresAt: { gt: new Date() },
        },
      })
      return this.serializeConversation(row.conversation, other?.user ?? null, unreadCount, userId)
    }))
    return {
      configuration: this.serializePublicConfig(config, restriction),
      conversations,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    }
  }

  async createConversation(userId: string, friendId: string) {
    await this.assertChatAvailable(userId, friendId)
    const pairKey = [userId, friendId].sort().join(":")
    const conversation = await this.prisma.$transaction(async (tx) => {
      const row = await tx.chatConversation.upsert({
        where: { pairKey },
        create: { pairKey, participants: { create: [{ userId }, { userId: friendId }] } },
        update: {},
        include: { participants: { include: { user: { select: publicUserSelect } } } },
      })
      return row
    })
    const other = conversation.participants.find((participant) => participant.userId !== userId)
    return this.serializeConversation(conversation, other?.user ?? null, 0, userId)
  }

  async createGroup(userId: string, name: string, memberIds: string[], imageUrl?: string | null) {
    const config = await this.ensureConfiguration()
    this.assertEnabled(config)
    const cleanName = name.trim()
    if (!cleanName) throw new ForbiddenException("Group name is required")
    const members = [...new Set(memberIds.filter((id) => id !== userId))]
    if (!members.length) throw new ForbiddenException("Add at least one friend to the group")
    if (members.length > 49) throw new ForbiddenException("A group can have at most 50 players")
    for (const memberId of members) await this.assertChatAvailable(userId, memberId)
    const conversation = await this.prisma.chatConversation.create({
      data: {
        type: ChatConversationType.GROUP,
        name: cleanName,
        imageUrl: imageUrl?.trim() || null,
        createdById: userId,
        participants: {
          create: [
            { userId, role: ChatParticipantRole.ADMIN },
            ...members.map((memberId) => ({ userId: memberId, role: ChatParticipantRole.MEMBER })),
          ],
        },
      },
      include: { participants: { include: { user: { select: publicUserSelect } } } },
    })
    return this.serializeConversation(conversation, null, 0, userId)
  }

  async addGroupMembers(userId: string, conversationId: string, memberIds: string[]) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    if (participant.conversation.type !== ChatConversationType.GROUP) throw new ForbiddenException("Members can only be added to group chats")
    if (participant.role !== ChatParticipantRole.ADMIN) throw new ForbiddenException("Only group admins can add members")
    const existingIds = new Set(participant.conversation.participants.map((row) => row.userId))
    const members = [...new Set(memberIds)].filter((id) => !existingIds.has(id) && id !== userId)
    if (existingIds.size + members.length > 50) throw new ForbiddenException("A group can have at most 50 players")
    for (const memberId of members) await this.assertChatAvailable(userId, memberId)
    if (members.length) await this.prisma.chatParticipant.createMany({ data: members.map((memberId) => ({ conversationId, userId: memberId, role: ChatParticipantRole.MEMBER })), skipDuplicates: true })
    return this.getConversationForUser(userId, conversationId)
  }

  async removeGroupMember(userId: string, conversationId: string, memberId: string) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    if (participant.conversation.type !== ChatConversationType.GROUP) throw new ForbiddenException("This is not a group chat")
    if (memberId !== userId && participant.role !== ChatParticipantRole.ADMIN) throw new ForbiddenException("Only group admins can remove members")
    const target = participant.conversation.participants.find((row) => row.userId === memberId)
    if (!target) throw new NotFoundException("Group member not found")
    if (target.role === ChatParticipantRole.ADMIN && memberId !== userId && participant.conversation.participants.filter((row) => row.role === ChatParticipantRole.ADMIN).length <= 1) throw new ForbiddenException("Promote another admin before removing the last admin")
    await this.prisma.chatParticipant.delete({ where: { conversationId_userId: { conversationId, userId: memberId } } })
    return { removed: true, conversationId, userId: memberId }
  }

  async leaveGroup(userId: string, conversationId: string) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    if (participant.conversation.type !== ChatConversationType.GROUP) throw new ForbiddenException("Only group chats can be left")
    const members = participant.conversation.participants.filter((row) => row.userId !== userId)
    await this.prisma.$transaction(async (tx) => {
      await tx.chatParticipant.delete({ where: { conversationId_userId: { conversationId, userId } } })
      if (participant.role === ChatParticipantRole.ADMIN && members.length && !members.some((row) => row.role === ChatParticipantRole.ADMIN)) {
        await tx.chatParticipant.update({ where: { conversationId_userId: { conversationId, userId: members[0].userId } }, data: { role: ChatParticipantRole.ADMIN } })
      }
      if (!members.length) await tx.chatConversation.update({ where: { id: conversationId }, data: { archivedAt: new Date() } })
    })
    return { left: true, conversationId }
  }

  async updateGroup(userId: string, conversationId: string, dto: { name?: string; imageUrl?: string | null }) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    if (participant.conversation.type !== ChatConversationType.GROUP || participant.role !== ChatParticipantRole.ADMIN) throw new ForbiddenException("Only group admins can edit the group")
    const name = dto.name?.trim()
    if (dto.name !== undefined && !name) throw new ForbiddenException("Group name is required")
    const updated = await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { ...(name === undefined ? {} : { name }), ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl?.trim() || null }) }, include: { participants: { include: { user: { select: publicUserSelect } } } } })
    return this.serializeConversation(updated, null, 0, userId)
  }

  async setWallpaper(userId: string, conversationId: string, wallpaperKey?: string | null) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const normalized = wallpaperKey?.trim() || null
    if (normalized && !/^wallpaper-[a-z0-9-]+$/.test(normalized)) throw new ForbiddenException("Invalid chat wallpaper")
    const updated = await this.prisma.chatParticipant.update({ where: { id: participant.id }, data: { wallpaperKey: normalized } })
    return { conversationId, wallpaperKey: updated.wallpaperKey }
  }

  private async getConversationForUser(userId: string, conversationId: string) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const other = participant.conversation.type === ChatConversationType.DIRECT_FRIEND ? participant.conversation.participants.find((row) => row.userId !== userId) : undefined
    return this.serializeConversation(participant.conversation, other?.user ?? null, 0, userId)
  }

  async listMessages(userId: string, conversationId: string, limit: number, before?: number) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        moderationState: ChatMessageState.VISIBLE,
        expiresAt: { gt: new Date() },
        ...(before ? { sequence: { lt: before } } : {}),
      },
      orderBy: { sequence: "desc" },
      take: limit + 1,
      include: { sender: { select: publicUserSelect } },
    })
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).reverse().map((row) => this.serializeMessage(row))
    return {
      conversation: this.serializeConversation(participant.conversation, this.otherUser(participant, userId), 0, userId),
      messages,
      hasMore,
      nextBefore: hasMore ? messages[0]?.sequence ?? null : null,
    }
  }

  async sendMessage(userId: string, conversationId: string, clientMessageId: string, body: string) {
    const config = await this.ensureConfiguration()
    this.assertEnabled(config)
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    await this.assertCanSend(userId)
    const recipients = participant.conversation.participants.filter((row) => row.userId !== userId)
    if (participant.conversation.type === ChatConversationType.DIRECT_FRIEND && recipients[0]) await this.assertCanReceive(recipients[0].userId)
    const cleanBody = body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
    if (!cleanBody) throw new ForbiddenException("Message cannot be empty")
    if (cleanBody.length > config.maxMessageLength) throw new ForbiddenException(`Message is limited to ${config.maxMessageLength} characters`)
    if (!config.allowLinks && /(?:https?:\/\/|www\.)/i.test(cleanBody)) throw new ForbiddenException("Links are not allowed in chat")
    if (clientMessageId.length > 120) throw new ForbiddenException("Invalid client message id")

    const existing = await this.prisma.chatMessage.findUnique({ where: { senderId_clientMessageId: { senderId: userId, clientMessageId } }, include: { sender: { select: publicUserSelect }, conversation: { include: { participants: true } } } })
    if (existing) {
      const recipients = existing.conversation.participants.filter((row) => row.userId !== userId)
      for (const recipient of recipients) void this.notifyMessage(config, existing, recipient.userId, existing.conversationId, existing.body, recipient.mutedUntil).catch((error) => this.logger.warn(`Chat notification failed: ${String(error)}`))
      return this.serializeMessage(existing)
    }

    const now = new Date()
    const message = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`
      const retry = await tx.chatMessage.findUnique({ where: { senderId_clientMessageId: { senderId: userId, clientMessageId } }, include: { sender: { select: publicUserSelect } } })
      if (retry) return retry
      const minuteCount = await tx.chatMessage.count({ where: { senderId: userId, createdAt: { gte: new Date(now.getTime() - 60_000) } } })
      const dayCount = await tx.chatMessage.count({ where: { senderId: userId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } })
      if (minuteCount >= config.maxMessagesPerMinute || dayCount >= config.maxMessagesPerDay) throw new HttpException("Chat message rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS)
      const duplicate = await tx.chatMessage.count({ where: { senderId: userId, body: cleanBody, createdAt: { gte: new Date(now.getTime() - 10_000) } } })
      if (duplicate > 0) throw new HttpException("Duplicate message blocked", HttpStatus.TOO_MANY_REQUESTS)
      await tx.$executeRaw`SELECT id FROM "ChatConversation" WHERE id = ${conversationId}::uuid FOR UPDATE`
      const latest = await tx.chatMessage.aggregate({ where: { conversationId, }, _max: { sequence: true } })
      const sequence = (latest._max.sequence ?? 0) + 1
      const created = await tx.chatMessage.create({
        data: {
          conversationId,
          senderId: userId,
          sequence,
          clientMessageId,
          body: cleanBody,
          expiresAt: new Date(now.getTime() + config.retentionDays * 86_400_000),
        },
        include: { sender: { select: publicUserSelect } },
      })
      await tx.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt, lastMessageId: created.id } })
      return created
    })
    for (const recipient of recipients) void this.notifyMessage(config, message, recipient.userId, conversationId, cleanBody, recipient.mutedUntil).catch((error) => this.logger.warn(`Chat notification failed: ${String(error)}`))
    return this.serializeMessage(message)
  }

  private notifyMessage(config: Config, message: any, recipientId: string, conversationId: string, preview?: string, participantMutedUntil?: Date | null) {
    return this.notifications.createChatMessageNotification({
      recipientId,
      messageId: message.id,
      conversationId,
      senderName: message.sender?.profile?.displayName || message.sender?.username || "New message",
      preview: this.chatNotificationPreview(preview?.trim() || message.body),
      enabled: !this.chatPresence.isActive(recipientId, conversationId) && (() => {
        const mutedUntil = participantMutedUntil ?? message.conversation?.participants?.find((row: any) => row.userId === recipientId)?.mutedUntil
        return !mutedUntil || mutedUntil <= new Date()
      })(),
      pushEnabled: config.pushNotificationsEnabled,
    })
  }

  private chatNotificationPreview(body: string) {
    const fallback = body.slice(0, 160)
    if (!body.startsWith("smarts-event:")) return fallback
    try {
      const event = JSON.parse(body.slice("smarts-event:".length)) as Record<string, unknown>
      const targetName = String(event.targetName || "a player")
      if (event.type === "gld_transfer") return `Sent ${String(event.amount || "")} GLD to ${targetName}`.slice(0, 160)
      if (event.type === "game_invite") return `Invited ${targetName} to play ${String(event.gameName || "a game")}`.slice(0, 160)
    } catch (_) {
      // Keep a safe preview if an older client sent malformed event data.
    }
    return fallback
  }

  async reportMessage(userId: string, conversationId: string, messageId: string, dto: ReportChatMessageDto) {
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, conversationId }, select: { id: true, moderationState: true } })
    if (!message) throw new NotFoundException("Message not found")
    const recentReports = await this.prisma.chatReport.count({ where: { reporterId: userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })
    if (recentReports >= 20) throw new HttpException("Report limit exceeded", HttpStatus.TOO_MANY_REQUESTS)
    const report = await this.prisma.chatReport.upsert({
      where: { dedupeKey: `${userId}:${messageId}` },
      create: { dedupeKey: `${userId}:${messageId}`, reporterId: userId, conversationId, messageId, category: dto.category, reason: dto.reason?.trim() || null },
      update: {},
    })
    if (message.moderationState === ChatMessageState.VISIBLE) await this.prisma.chatMessage.update({ where: { id: messageId }, data: { moderationState: ChatMessageState.FLAGGED } })
    return { id: report.id, status: report.status }
  }

  async reportConversation(userId: string, conversationId: string, dto: ReportChatMessageDto) {
    await this.getAuthorizedParticipant(userId, conversationId)
    const recentReports = await this.prisma.chatReport.count({ where: { reporterId: userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })
    if (recentReports >= 20) throw new HttpException("Report limit exceeded", HttpStatus.TOO_MANY_REQUESTS)
    const report = await this.prisma.chatReport.upsert({
      where: { dedupeKey: `${userId}:conversation:${conversationId}` },
      create: { dedupeKey: `${userId}:conversation:${conversationId}`, reporterId: userId, conversationId, category: dto.category, reason: dto.reason?.trim() || null },
      update: {},
    })
    return { id: report.id, status: report.status }
  }

  async listAdminConversations(query: AdminChatsQueryDto) {
    const take = query.limit + 1
    const search = query.search?.trim()
    const isUuid = Boolean(search && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search))
    const where: Prisma.ChatConversationWhereInput = {
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      ...(query.userId ? { participants: { some: { userId: query.userId } } } : {}),
      ...(search ? { OR: [
        ...(isUuid ? [{ id: search }] : []),
        ...(isUuid ? [{ participants: { some: { userId: search } } }] : []),
        { participants: { some: { user: { username: { contains: search, mode: "insensitive" } } } } },
        { participants: { some: { user: { profile: { displayName: { contains: search, mode: "insensitive" } } } } } },
        { messages: { some: { id: isUuid ? search : undefined } } },
      ] } : {}),
      ...(query.status === "ARCHIVED" ? { archivedAt: { not: null } } : query.status === "ACTIVE" ? { archivedAt: null } : {}),
      ...(query.status === "REPORTED" ? { reports: { some: { status: "OPEN" } } } : {}),
      ...(query.status === "MUTED" ? { participants: { some: { mutedUntil: { gt: new Date() } } } } : {}),
      ...(query.status === "RESTRICTED" ? { participants: { some: { user: { chatRestrictions: { some: { revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] } } } } } } : {}),
      ...(query.status === "EXPIRING" ? { messages: { some: { expiresAt: { gt: new Date(), lt: new Date(Date.now() + 86_400_000) } } } } : {}),
    }
    const rows = await this.prisma.chatConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take,
      include: { participants: { include: { user: { select: adminUserSelect } } }, messages: { where: { expiresAt: { gt: new Date() } }, orderBy: { sequence: "desc" }, take: 1, include: { sender: { select: publicUserSelect } } }, _count: { select: { messages: { where: { expiresAt: { gt: new Date() } } }, reports: true } } },
    })
    const hasMore = rows.length > query.limit
    const page = rows.slice(0, query.limit)
    return { conversations: page.map((row) => ({ id: row.id, status: row.archivedAt ? "ARCHIVED" : "ACTIVE", archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, participants: row.participants.map((item) => ({ ...this.serializeUser(item.user), lastOnline: item.user.lastOnline?.toISOString() ?? null })), lastMessage: row.messages[0] ? this.serializeMessage(row.messages[0]) : null, messageCount: row._count.messages, reportCount: row._count.reports })), nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null }
  }

  async listAdminMessages(conversationId: string, query: AdminChatMessagesQueryDto) {
    const rows = await this.prisma.chatMessage.findMany({ where: { conversationId, expiresAt: { gt: new Date() }, ...(query.before ? { sequence: { lt: query.before } } : {}) }, orderBy: { sequence: "desc" }, take: query.limit + 1, include: { sender: { select: publicUserSelect }, reports: { select: { id: true, category: true, status: true, reason: true, createdAt: true } } } })
    const hasMore = rows.length > query.limit
    const page = rows.slice(0, query.limit).reverse()
    return { messages: page.map((row) => ({ ...this.serializeMessage(row), reports: row.reports })), hasMore, nextBefore: hasMore ? page[0]?.sequence ?? null : null }
  }

  async updateAdminConversationStatus(conversationId: string, dto: AdminChatStatusDto, adminId: string) {
    const row = await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { archivedAt: dto.status === "ARCHIVED" ? new Date() : null } })
    await this.audit(adminId, "CHAT_CONVERSATION_STATUS_UPDATED", conversationId, dto.reason || `Conversation marked ${dto.status.toLowerCase()}`, { status: dto.status })
    return { id: row.id, status: row.archivedAt ? "ARCHIVED" : "ACTIVE", archivedAt: row.archivedAt }
  }

  async removeAdminMessage(messageId: string, dto: AdminRemoveChatMessageDto, adminId: string) {
    const row = await this.prisma.chatMessage.update({ where: { id: messageId }, data: { moderationState: ChatMessageState.REMOVED, deletedAt: new Date(), deletedBy: adminId } })
    await this.audit(adminId, "CHAT_MESSAGE_REMOVED", messageId, dto.reason, { conversationId: row.conversationId })
    return this.serializeMessage(row)
  }

  async preserveAdminMessage(messageId: string, dto: AdminPreserveChatEvidenceDto, adminId: string) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true, senderId: true, body: true, createdAt: true } })
    if (!message) throw new NotFoundException("Message not found")
    const evidence = await this.prisma.chatEvidence.create({ data: { messageId: message.id, conversationId: message.conversationId, senderId: message.senderId, body: message.body, messageCreatedAt: message.createdAt, reason: dto.reason, caseReference: dto.caseReference?.trim() || null, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, preservedBy: adminId } })
    await this.audit(adminId, "CHAT_MESSAGE_EVIDENCE_PRESERVED", messageId, dto.reason, { caseReference: dto.caseReference || null, evidenceId: evidence.id })
    return { id: evidence.id, expiresAt: evidence.expiresAt }
  }

  async restrictConversation(conversationId: string, dto: AdminChatRestrictionDto, adminId: string) {
    await this.assertParticipant(conversationId, dto.userId)
    const restriction = await this.prisma.chatRestriction.create({ data: { userId: dto.userId, reason: dto.reason, restrictedUntil: dto.restrictedUntil ? new Date(dto.restrictedUntil) : null, createdBy: adminId } })
    await this.audit(adminId, "CHAT_PLAYER_RESTRICTED", dto.userId, dto.reason, { conversationId, restrictionId: restriction.id, restrictedUntil: restriction.restrictedUntil })
    return { id: restriction.id, userId: restriction.userId, restrictedUntil: restriction.restrictedUntil }
  }

  async unrestrictConversation(conversationId: string, dto: AdminChatUnrestrictionDto, adminId: string) {
    await this.assertParticipant(conversationId, dto.userId)
    const active = await this.prisma.chatRestriction.findFirst({ where: { userId: dto.userId, revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } })
    if (active) await this.prisma.chatRestriction.update({ where: { id: active.id }, data: { revokedAt: new Date(), revokedBy: adminId } })
    await this.audit(adminId, "CHAT_PLAYER_UNRESTRICTED", dto.userId, dto.reason || "Chat restriction revoked", { conversationId, restrictionId: active?.id || null })
    return { revoked: Boolean(active) }
  }

  async muteConversation(conversationId: string, dto: AdminMuteChatDto, adminId: string) {
    await this.assertParticipant(conversationId, dto.userId)
    const participant = await this.prisma.chatParticipant.update({ where: { conversationId_userId: { conversationId, userId: dto.userId } }, data: { mutedUntil: dto.mutedUntil ? new Date(dto.mutedUntil) : null } })
    await this.audit(adminId, "CHAT_CONVERSATION_MUTED", conversationId, dto.reason || "Conversation notification setting updated", { userId: dto.userId, mutedUntil: participant.mutedUntil })
    return { conversationId, userId: dto.userId, mutedUntil: participant.mutedUntil }
  }

  async listAdminReports(query: AdminChatReportQueryDto) {
    const reports = await this.prisma.chatReport.findMany({ where: query.status ? { status: query.status as any } : {}, orderBy: { createdAt: "desc" }, take: query.limit, include: { reporter: { select: publicUserSelect }, conversation: { select: { id: true } }, message: { select: { id: true, body: true, senderId: true, moderationState: true, createdAt: true } } } })
    return reports.map((report) => ({ ...report, message: report.message ? { ...report.message, body: report.message.moderationState === ChatMessageState.REMOVED ? "Message removed by moderation" : report.message.body } : null }))
  }

  async resolveAdminReport(reportId: string, dto: AdminResolveChatReportDto, adminId: string) {
    const report = await this.prisma.chatReport.update({ where: { id: reportId }, data: { status: dto.status as any, resolutionNote: dto.resolutionNote, reviewedBy: adminId, reviewedAt: new Date() } })
    await this.audit(adminId, `CHAT_REPORT_${dto.status}`, reportId, dto.resolutionNote, { conversationId: report.conversationId, messageId: report.messageId })
    return report
  }

  async retentionStatus() {
    const config = await this.ensureConfiguration()
    const [expiredMessages, evidence] = await Promise.all([
      this.prisma.chatMessage.count({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.chatEvidence.count({ where: { expiresAt: { lt: new Date() } } }),
    ])
    return { retentionDays: config.retentionDays, lastCleanupAt: config.lastCleanupAt, lastCleanupDeleted: config.lastCleanupDeleted, expiredMessages, expiredEvidence: evidence }
  }

  async runRetentionCleanup(adminId?: string) {
    await this.cleanupExpiredMessages()
    const deletedEvidence = await this.prisma.chatEvidence.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    if (adminId) await this.audit(adminId, "CHAT_RETENTION_RUN", "retention", "Manual chat retention cleanup", { deletedEvidence: deletedEvidence.count })
    return this.retentionStatus()
  }

  async markRead(userId: string, conversationId: string, sequence: number) {
    await this.getAuthorizedParticipant(userId, conversationId)
    const current = await this.prisma.chatParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { lastReadSequence: true } })
    if (current && sequence > current.lastReadSequence) await this.prisma.chatParticipant.update({ where: { conversationId_userId: { conversationId, userId } }, data: { lastReadSequence: sequence } })
    return { ok: true, lastReadSequence: Math.max(current?.lastReadSequence ?? 0, sequence) }
  }

  async mute(userId: string, conversationId: string, mutedUntil?: string | null) {
    await this.getAuthorizedParticipant(userId, conversationId)
    const row = await this.prisma.chatParticipant.update({ where: { conversationId_userId: { conversationId, userId } }, data: { mutedUntil: mutedUntil ? new Date(mutedUntil) : null } })
    return { mutedUntil: row.mutedUntil }
  }

  private async ensureConfiguration(): Promise<Config> {
    return this.prisma.chatConfiguration.upsert({ where: { key: DEFAULT_CONFIG.key }, create: DEFAULT_CONFIG, update: {} })
  }

  private async assertChatAvailable(userId: string, friendId: string) {
    const config = await this.ensureConfiguration()
    this.assertEnabled(config)
    if (userId === friendId) throw new ForbiddenException("You cannot chat with yourself")
    const [user, friend, friendship, block] = await this.prisma.$transaction([
      this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
      this.prisma.user.findUnique({ where: { id: friendId }, select: { status: true } }),
      this.prisma.friendship.findUnique({ where: { userId_friendId: { userId, friendId } } }),
      this.prisma.friendBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: friendId }, { blockerId: friendId, blockedId: userId }] } }),
    ])
    if (!user || user.status !== UserStatus.ACTIVE || !friend || friend.status !== UserStatus.ACTIVE) throw new NotFoundException("Player not found")
    if (block) throw new ForbiddenException("Chat is unavailable for this friendship")
    if (config.friendChatOnly && !friendship) throw new ForbiddenException("You can only chat with accepted friends")
  }

  private async assertCanSend(userId: string) {
    const restriction = await this.prisma.chatRestriction.findFirst({ where: { userId, revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } })
    if (restriction) throw new ForbiddenException("Your chat access is temporarily restricted")
  }

  private async assertCanReceive(userId: string) {
    const restriction = await this.prisma.chatRestriction.findFirst({ where: { userId, revokedAt: null, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: new Date() } }] }, select: { id: true } })
    if (restriction) throw new ForbiddenException("This player cannot receive chat messages right now")
  }

  private async assertParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.chatParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } })
    if (!participant) throw new NotFoundException("Conversation participant not found")
  }

  private async audit(actorId: string, action: string, entityId: string, reason: string, metadata?: Prisma.InputJsonValue) {
    const safeMetadata = metadata === undefined ? undefined : JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue
    await this.prisma.adminAuditEvent.create({ data: { actorId, action, entityType: "FriendChat", entityId, reason: reason.slice(0, 500), metadata: safeMetadata } }).catch((error) => this.logger.warn(`Chat audit write failed: ${String(error)}`))
  }

  private async getAuthorizedParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { conversation: { include: { participants: { include: { user: { select: publicUserSelect } } } } } },
    })
    if (!participant) throw new NotFoundException("Conversation not found")
    if (participant.conversation.type === ChatConversationType.GROUP) {
      const config = await this.ensureConfiguration()
      this.assertEnabled(config)
    } else {
      const other = participant.conversation.participants.find((row) => row.userId !== userId)
      if (!other) throw new NotFoundException("Conversation not found")
      await this.assertChatAvailable(userId, other.userId)
    }
    return participant
  }

  private assertEnabled(config: Config) {
    if (!config.enabled) throw new ForbiddenException(config.maintenanceMessage || "Chat is temporarily unavailable")
  }

  private otherUser(participant: any, userId: string) {
    return participant.conversation.participants.find((row: any) => row.userId !== userId)?.user ?? null
  }

  private serializeConfig(config: Config) {
    return { ...config, createdAt: config.createdAt.toISOString(), updatedAt: config.updatedAt.toISOString(), lastCleanupAt: config.lastCleanupAt?.toISOString() ?? null }
  }

  private serializePublicConfig(config: Config, restriction?: { restrictedUntil: Date | null } | null) {
    return {
      enabled: config.enabled,
      retentionDays: config.retentionDays,
      maxMessageLength: config.maxMessageLength,
      typingEnabled: config.typingEnabled,
      readReceiptsEnabled: config.readReceiptsEnabled,
      pushNotificationsEnabled: config.pushNotificationsEnabled,
      friendChatOnly: config.friendChatOnly,
      maintenanceMessage: config.maintenanceMessage,
      restricted: Boolean(restriction),
      restrictionUntil: restriction?.restrictedUntil?.toISOString() ?? null,
    }
  }

  private serializeUser(user: any) {
    return user ? { id: user.id, username: user.username, name: user.profile?.displayName || user.username, avatarUrl: user.profile?.avatarUrl ?? null } : null
  }

  private serializeConversation(conversation: any, otherUser: any, unreadCount: number, viewerId?: string) {
    const viewer = viewerId ? conversation.participants?.find((row: any) => row.userId === viewerId) : null
    return {
      id: conversation.id,
      type: conversation.type,
      friend: this.serializeUser(otherUser),
      title: conversation.name ?? null,
      imageUrl: conversation.imageUrl ?? null,
      createdById: conversation.createdById ?? null,
      wallpaperKey: viewer?.wallpaperKey ?? null,
      mutedUntil: viewer?.mutedUntil?.toISOString() ?? null,
      participants: conversation.type === ChatConversationType.GROUP ? (conversation.participants ?? []).map((row: any) => ({ ...this.serializeUser(row.user), role: row.role })) : [],
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessage: conversation.messages?.[0] ? this.serializeMessage(conversation.messages[0]) : null,
      unreadCount,
    }
  }

  private serializeMessage(message: any) {
    return { id: message.id, conversationId: message.conversationId, senderId: message.senderId, sender: this.serializeUser(message.sender), sequence: message.sequence, clientMessageId: message.clientMessageId, body: message.moderationState === ChatMessageState.REMOVED ? "Message removed by moderation" : message.body, createdAt: message.createdAt.toISOString(), expiresAt: message.expiresAt.toISOString(), state: message.moderationState }
  }

  private async cleanupExpiredMessages() {
    try {
      let deleted = 0
      while (true) {
        const rows = await this.prisma.chatMessage.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true }, take: 500 })
        if (!rows.length) break
        const result = await this.prisma.chatMessage.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
        deleted += result.count
        if (rows.length < 500) break
      }
      await this.prisma.chatConfiguration.updateMany({ where: { key: DEFAULT_CONFIG.key }, data: { lastCleanupAt: new Date(), lastCleanupDeleted: deleted } })
    } catch (error) {
      this.logger.warn(`Chat retention cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
