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
import { ChatMessageState, Prisma, UserStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { UpdateChatConfigurationDto } from "./dtos"

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
  friendChatOnly: true,
  allowLinks: false,
  maintenanceMessage: null,
} as const

const publicUserSelect = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} satisfies Prisma.UserSelect

type Config = Prisma.ChatConfigurationGetPayload<{}>

@Injectable()
export class ChatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatsService.name)
  private cleanupTimer?: NodeJS.Timeout

  constructor(private readonly prisma: PrismaService) {}

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

  async getPublicConfiguration() {
    const config = await this.ensureConfiguration()
    return {
      enabled: config.enabled,
      retentionDays: config.retentionDays,
      maxMessageLength: config.maxMessageLength,
      typingEnabled: config.typingEnabled,
      readReceiptsEnabled: config.readReceiptsEnabled,
      pushNotificationsEnabled: config.pushNotificationsEnabled,
      friendChatOnly: config.friendChatOnly,
      maintenanceMessage: config.maintenanceMessage,
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
              where: { moderationState: ChatMessageState.VISIBLE, expiresAt: { gt: new Date() } },
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
      const other = row.conversation.participants.find((participant) => participant.userId !== userId)
      const unreadCount = await this.prisma.chatMessage.count({
        where: {
          conversationId: row.conversationId,
          sequence: { gt: row.lastReadSequence },
          senderId: { not: userId },
          moderationState: ChatMessageState.VISIBLE,
          expiresAt: { gt: new Date() },
        },
      })
      return this.serializeConversation(row.conversation, other?.user ?? null, unreadCount)
    }))
    return {
      configuration: this.serializePublicConfig(config),
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
    return this.serializeConversation(conversation, other?.user ?? null, 0)
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
      conversation: this.serializeConversation(participant.conversation, this.otherUser(participant, userId), 0),
      messages,
      hasMore,
      nextBefore: hasMore ? messages[0]?.sequence ?? null : null,
    }
  }

  async sendMessage(userId: string, conversationId: string, clientMessageId: string, body: string) {
    const config = await this.ensureConfiguration()
    this.assertEnabled(config)
    const participant = await this.getAuthorizedParticipant(userId, conversationId)
    const cleanBody = body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
    if (!cleanBody) throw new ForbiddenException("Message cannot be empty")
    if (cleanBody.length > config.maxMessageLength) throw new ForbiddenException(`Message is limited to ${config.maxMessageLength} characters`)
    if (!config.allowLinks && /(?:https?:\/\/|www\.)/i.test(cleanBody)) throw new ForbiddenException("Links are not allowed in chat")
    if (clientMessageId.length > 120) throw new ForbiddenException("Invalid client message id")

    const existing = await this.prisma.chatMessage.findUnique({ where: { senderId_clientMessageId: { senderId: userId, clientMessageId } }, include: { sender: { select: publicUserSelect } } })
    if (existing) return this.serializeMessage(existing)

    const now = new Date()
    const message = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`
      const retry = await tx.chatMessage.findUnique({ where: { senderId_clientMessageId: { senderId: userId, clientMessageId } }, include: { sender: { select: publicUserSelect } } })
      if (retry) return retry
      const minuteCount = await tx.chatMessage.count({ where: { senderId: userId, createdAt: { gte: new Date(now.getTime() - 60_000) } } })
      const dayCount = await tx.chatMessage.count({ where: { senderId: userId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } })
      if (minuteCount >= config.maxMessagesPerMinute || dayCount >= config.maxMessagesPerDay) throw new HttpException("Chat message rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS)
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
    return this.serializeMessage(message)
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

  private async getAuthorizedParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { conversation: { include: { participants: { include: { user: { select: publicUserSelect } } } } } },
    })
    if (!participant) throw new NotFoundException("Conversation not found")
    const other = participant.conversation.participants.find((row) => row.userId !== userId)
    if (!other) throw new NotFoundException("Conversation not found")
    await this.assertChatAvailable(userId, other.userId)
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

  private serializePublicConfig(config: Config) {
    return {
      enabled: config.enabled,
      retentionDays: config.retentionDays,
      maxMessageLength: config.maxMessageLength,
      typingEnabled: config.typingEnabled,
      readReceiptsEnabled: config.readReceiptsEnabled,
      pushNotificationsEnabled: config.pushNotificationsEnabled,
      friendChatOnly: config.friendChatOnly,
      maintenanceMessage: config.maintenanceMessage,
    }
  }

  private serializeUser(user: any) {
    return user ? { id: user.id, username: user.username, name: user.profile?.displayName || user.username, avatarUrl: user.profile?.avatarUrl ?? null } : null
  }

  private serializeConversation(conversation: any, otherUser: any, unreadCount: number) {
    return { id: conversation.id, type: conversation.type, friend: this.serializeUser(otherUser), lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null, lastMessage: conversation.messages?.[0] ? this.serializeMessage(conversation.messages[0]) : null, unreadCount }
  }

  private serializeMessage(message: any) {
    return { id: message.id, conversationId: message.conversationId, senderId: message.senderId, sender: this.serializeUser(message.sender), sequence: message.sequence, clientMessageId: message.clientMessageId, body: message.body, createdAt: message.createdAt.toISOString(), expiresAt: message.expiresAt.toISOString(), state: message.moderationState }
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
