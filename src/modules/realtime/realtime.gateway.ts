import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { WebSocketGateway } from "@nestjs/websockets"
import { IncomingMessage } from "node:http"
import { URL } from "node:url"
import { MatchmakingService } from "../matchmaking/matchmaking.service"
import { MatchService } from "../matches/match.service"
import { PrismaService } from "../../prisma.service"
import { getAuthConfig } from "../auth/auth.config"
import { ChatsService } from "../chats/chats.service"
import { ChatPresenceRegistry } from "../chats/chat-presence.registry"
import { SupportLiveChatService } from "../support/support-live-chat.service"
import type { JwtPayload } from "../auth/dtos/jwt-payload.dto"
import type { WebSocket } from "ws"
import { PartyService } from "../cooperative/party.service"
import { GemBlitzService } from "../gem-blitz/gem-blitz.service"
import { TileRushService } from "../tile-rush/tile-rush.service"
import { randomUUID } from "node:crypto"

type ClientState = {
  userId: string
  matchIds: Set<string>
  playerIds: Set<string>
  queueSubscribed: boolean
  chatConversationIds: Set<string>
  supportSessionIds: Set<string>
  supportQueueSubscribed: boolean
  partyIds: Set<string>
  lastSnapshots: Map<string, string>
}

/**
 * Authenticated native WebSocket transport for mobile realtime updates.
 *
 * The database remains authoritative. The gateway watches the same safe HTTP
 * projections returned to mobile and emits only when those projections
 * change. This keeps socket reconnects and multi-instance Railway deploys
 * safe while allowing Flutter to use HTTP as a bounded fallback.
 */
@Injectable()
@WebSocketGateway({ path: "/ws" })
export class RealtimeGateway implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name)
  private readonly clients = new Map<WebSocket, ClientState>()
  private readonly typingTimers = new Map<string, NodeJS.Timeout>()
  private readonly typingLastSent = new Map<string, number>()
  private readonly timer: NodeJS.Timeout
  private publishing = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly matches: MatchService,
    private readonly matchmaking: MatchmakingService,
    private readonly chats: ChatsService,
    private readonly chatPresence: ChatPresenceRegistry,
    private readonly supportLiveChat: SupportLiveChatService,
    private readonly parties: PartyService,
    private readonly gemBlitz: GemBlitzService,
    private readonly tileRush: TileRushService,
  ) {
    // Gameplay actions push an immediate snapshot. This timer is only the
    // recovery/clock path, so polling every second needlessly re-queries and
    // advances every active board match for every connected socket.
    this.timer = setInterval(() => void this.publishChanges(), 2000)
    this.timer.unref()
  }

  handleConnection(client: WebSocket, request: IncomingMessage) {
    void this.authenticate(client, request)
  }

  handleDisconnect(client: WebSocket) {
    const state = this.clients.get(client)
    this.clients.delete(client)
    if (state) {
      this.chatPresence.clearUser(state.userId, state.chatConversationIds)
      void this.clearTypingForClient(state)
      void this.prisma.cooperativeParticipant.updateMany({ where: { userId: state.userId, cooperativeMatch: { match: { status: "STARTED" } } }, data: { disconnectedAt: new Date() } }).catch(() => undefined)
      if (!this.isOnline(state.userId)) void this.supportLiveChat.updateAgentStatus(state.userId, "OFFLINE" as any).catch(() => undefined)
    }
    if (state && !this.isOnline(state.userId)) this.broadcastPresence(state.userId, false)
  }

  onModuleDestroy() {
    clearInterval(this.timer)
    for (const client of this.clients.keys()) client.close(1001, "Server shutting down")
    for (const timer of this.typingTimers.values()) clearTimeout(timer)
    this.typingTimers.clear()
    this.typingLastSent.clear()
    this.clients.clear()
  }

  private async authenticate(client: WebSocket, request: IncomingMessage) {
    try {
      const token = this.readToken(request)
      if (!token) throw new Error("Missing access token")
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: getAuthConfig().accessSecret })
      if (payload.tokenUse !== "ACCESS_TOKEN" || !payload.userId || !payload.tokenId) throw new Error("Invalid access token")
      const session = await this.prisma.session.findFirst({ where: { userId: payload.userId, tokenId: payload.tokenId, sessionStatus: "ACTIVE", expiresAt: { gt: new Date() } }, select: { id: true } })
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, status: true } })
      if (!session || !user || user.status !== "ACTIVE") throw new Error("Session is no longer active")

      const state: ClientState = { userId: user.id, matchIds: new Set(), playerIds: new Set([user.id]), queueSubscribed: false, chatConversationIds: new Set(), supportSessionIds: new Set(), supportQueueSubscribed: false, partyIds: new Set(), lastSnapshots: new Map() }
      this.clients.set(client, state)
      client.on("message", (message) => void this.handleMessage(client, state, message.toString()))
      client.on("close", () => this.handleDisconnect(client))
      client.on("error", () => this.handleDisconnect(client))
      this.send(client, "ready", { userId: user.id, protocol: 1 })
      this.broadcastPresence(user.id, true)
      await this.sendQueueSnapshot(client, state, true)
    } catch (error) {
      this.logger.debug(`WebSocket authentication rejected: ${error instanceof Error ? error.message : "invalid request"}`)
      client.close(1008, "Authentication failed")
    }
  }

  private async handleMessage(client: WebSocket, state: ClientState, raw: string) {
    let message: { event?: string; data?: Record<string, unknown> }
    try { message = JSON.parse(raw) as typeof message } catch { this.send(client, "error", { message: "Message must be JSON" }); return }
    const event = message.event ?? ""
    const data = message.data ?? {}
    if (event === "ping") { this.send(client, "pong", { at: new Date().toISOString() }); return }
    if (event === "subscribe_queue") { state.queueSubscribed = true; await this.sendQueueSnapshot(client, state, true); return }
    if (event === "unsubscribe_queue") { state.queueSubscribed = false; return }
    if (event === "subscribe_match") {
      const matchId = typeof data.matchId === "string" ? data.matchId : ""
      const authorized = matchId && await this.prisma.matchParticipant.findFirst({ where: { matchId, userId: state.userId }, select: { id: true } })
      if (!authorized) { this.send(client, "error", { code: "MATCH_NOT_FOUND", message: "Match is not available" }); return }
      state.matchIds.add(matchId)
      await this.prisma.cooperativeParticipant.updateMany({ where: { userId: state.userId, cooperativeMatch: { matchId } }, data: { connectedAt: new Date(), disconnectedAt: null } })
      await this.sendMatchSnapshot(client, state, matchId, true)
      return
    }
    if (event === "unsubscribe_match") {
      if (typeof data.matchId === "string") {
        const matchId = data.matchId.trim()
        state.matchIds.delete(matchId)
        this.clearMatchSnapshots(state, matchId)
      }
      return
    }
    if (event === "gem_blitz.move") {
      const matchId = this.string(data.matchId)
      if (!matchId || !state.matchIds.has(matchId)) return this.send(client, "gem_blitz.error", { code: "NOT_SUBSCRIBED", message: "Subscribe to the match first" })
      try {
        const snapshot = await this.gemBlitz.move(state.userId, matchId, { sequence: Number(data.sequence), fromRow: Number(data.fromRow), fromColumn: Number(data.fromColumn), toRow: Number(data.toRow), toColumn: Number(data.toColumn), clientTimestamp: typeof data.clientTimestamp === "string" ? data.clientTimestamp : undefined })
        this.send(client, "gem_blitz.move.accepted", snapshot)
        await this.broadcastGemBlitz(matchId)
      } catch (error) { this.send(client, "gem_blitz.error", { code: "MOVE_REJECTED", message: this.errorMessage(error) }) }
      return
    }
    if (event === "tile_rush.action") {
      const matchId = this.string(data.matchId)
      if (!matchId || !state.matchIds.has(matchId)) return this.send(client, "tile_rush.error", { code: "NOT_SUBSCRIBED", message: "Subscribe to the match first" })
      try {
        const rawPath = Array.isArray(data.path) ? data.path : []
        const path = rawPath.map((point) => Array.isArray(point) ? { row: Number(point[0]), column: Number(point[1]) } : { row: Number((point as Record<string, unknown>).row), column: Number((point as Record<string, unknown>).column) })
        const snapshot = await this.tileRush.action(state.userId, matchId, { sequence: Number(data.sequence), path, clientActionId: this.string(data.clientActionId) || randomUUID(), clientStartedAt: typeof data.clientStartedAt === "string" ? data.clientStartedAt : undefined, clientReleasedAt: typeof data.clientReleasedAt === "string" ? data.clientReleasedAt : undefined, boardHashBefore: typeof data.boardHashBefore === "string" ? data.boardHashBefore : undefined })
        this.send(client, snapshot.action?.accepted === false ? "tile_rush.action.rejected" : "tile_rush.action.accepted", snapshot)
        await this.broadcastTileRush(matchId)
      } catch (error) { this.send(client, "tile_rush.error", { code: "ACTION_REJECTED", message: this.errorMessage(error) }) }
      return
    }
    if (event === "subscribe_player") {
      if (typeof data.userId === "string" && data.userId.trim()) {
        const playerId = data.userId.trim()
        state.playerIds.add(playerId)
        this.send(client, "presence.snapshot", { userId: playerId, state: this.isOnline(playerId) ? "ONLINE" : "OFFLINE" })
      }
      return
    }
    if (event === "unsubscribe_player") {
      if (typeof data.userId === "string") state.playerIds.delete(data.userId.trim())
      return
    }
    if (event === "chat.subscribe") {
      await this.subscribeChat(client, state, data)
      return
    }
    if (event === "chat.unsubscribe") {
      if (typeof data.conversationId === "string") {
        const conversationId = data.conversationId.trim()
        state.chatConversationIds.delete(conversationId)
        state.lastSnapshots.delete(`chat:${conversationId}`)
        this.chatPresence.unsubscribe(state.userId, conversationId)
      }
      return
    }
    if (event === "chat.message.send") {
      await this.sendChatMessage(client, state, data)
      return
    }
    if (event === "chat.voice.send") {
      await this.sendChatVoiceMessage(client, state, data)
      return
    }
    if (event === "chat.typing.start" || event === "chat.typing.stop") {
      await this.changeTyping(client, state, data, event === "chat.typing.start")
      return
    }
    if (event === "chat.read") {
      await this.readChat(client, state, data)
      return
    }
    if (event === "chat.presence.subscribe") {
      await this.subscribeChatPresence(client, state, data)
      return
    }
    if (event === "chat.presence.unsubscribe") {
      if (typeof data.userId === "string") state.playerIds.delete(data.userId.trim())
      return
    }
    if (event === "party.subscribe") { await this.subscribeParty(client, state, data); return }
    if (event === "party.unsubscribe") {
      if (typeof data.partyId === "string") {
        const partyId = data.partyId.trim()
        state.partyIds.delete(partyId)
        state.lastSnapshots.delete(`party:${partyId}`)
      }
      return
    }
    if (event === "support.subscribe") { await this.subscribeSupport(client, state, data); return }
    if (event === "support.unsubscribe") {
      if (typeof data.sessionId === "string") {
        const sessionId = data.sessionId.trim()
        state.supportSessionIds.delete(sessionId)
        state.lastSnapshots.delete(`support-session:${sessionId}`)
      }
      return
    }
    if (event === "support.typing.start" || event === "support.typing.stop") { await this.supportTyping(client, state, data, event === "support.typing.start"); return }
    if (event === "support.read") { await this.supportRead(client, state, data); return }
    if (event === "support.message.send") { await this.supportMessage(client, state, data); return }
    if (event === "support.agent.subscribe-queue") { const agent = await this.supportLiveChat.agentMe(state.userId); if (agent) { state.supportQueueSubscribed = true; this.send(client, "support.queue.ready", agent) } return }
    if (event === "support.agent.unsubscribe-queue") { state.supportQueueSubscribed = false; return }
    if (event === "support.agent.presence") { const status = typeof data.status === "string" ? data.status : "OFFLINE"; if (!["AVAILABLE", "BUSY", "OFFLINE"].includes(status)) return this.send(client, "support.error", { code: "INVALID_PRESENCE", message: "Use AVAILABLE, BUSY, or OFFLINE" }); await this.supportLiveChat.updateAgentStatus(state.userId, status as any); this.broadcastSupportQueue("support.queue.agent-availability-changed", { userId: state.userId, status }); return }
    this.send(client, "error", { message: "Unknown event" })
  }

  private async subscribeChat(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const conversationId = this.string(data.conversationId)
    if (!conversationId) return this.chatError(client, "INVALID_CONVERSATION", "Conversation is required")
    try {
      const authorized = await this.chats.authorizeConversation(state.userId, conversationId)
      if (!state.chatConversationIds.has(conversationId)) {
        state.chatConversationIds.add(conversationId)
        this.chatPresence.subscribe(state.userId, conversationId)
      }
      this.send(client, "chat.ready", { conversationId, retentionDays: authorized.retentionDays })
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error)) }
  }

  private async sendChatMessage(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const conversationId = this.string(data.conversationId)
    const clientMessageId = this.string(data.clientMessageId)
    const body = typeof data.body === "string" ? data.body : ""
    if (!conversationId || !clientMessageId) return this.chatError(client, "INVALID_MESSAGE", "Conversation and client message id are required", clientMessageId)
    try {
      const message = await this.chats.sendMessage(state.userId, conversationId, clientMessageId, body)
      const participantIds = await this.chats.participantIds(conversationId)
      this.send(client, "chat.message.accepted", { message })
      for (const [otherClient, otherState] of this.clients) {
        if (otherClient === client) continue
        if (!participantIds.includes(otherState.userId)) continue
        this.send(otherClient, "chat.message.created", { message })
      }
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error), clientMessageId) }
  }

  private async sendChatVoiceMessage(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const conversationId = this.string(data.conversationId)
    const clientMessageId = this.string(data.clientMessageId)
    const messageId = this.string(data.messageId)
    const objectKey = this.string(data.objectKey)
    if (!conversationId || !clientMessageId || !messageId || !objectKey) return this.chatError(client, "INVALID_MESSAGE", "Voice message data is incomplete", clientMessageId)
    try {
      const message = await this.chats.sendVoiceMessage(state.userId, conversationId, { clientMessageId, messageId, objectKey, durationMs: Number(data.durationMs), byteSize: Number(data.byteSize), mimeType: this.string(data.mimeType) })
      const participantIds = await this.chats.participantIds(conversationId)
      this.send(client, "chat.message.accepted", { message })
      for (const [otherClient, otherState] of this.clients) {
        if (otherClient === client || !participantIds.includes(otherState.userId)) continue
        this.send(otherClient, "chat.message.created", { message })
      }
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error), clientMessageId) }
  }

  private async changeTyping(client: WebSocket, state: ClientState, data: Record<string, unknown>, typing: boolean) {
    const conversationId = this.string(data.conversationId)
    if (!conversationId || !state.chatConversationIds.has(conversationId)) return this.chatError(client, "NOT_SUBSCRIBED", "Subscribe to the conversation first")
    try {
      const config = await this.chats.getPublicConfiguration()
      if (!config.enabled || !config.typingEnabled) return
      await this.chats.authorizeConversation(state.userId, conversationId)
      const key = `${conversationId}:${state.userId}`
      const now = Date.now()
      const lastSent = this.typingLastSent.get(key) ?? 0
      if (typing && now - lastSent < 250) return
      this.typingLastSent.set(key, now)
      const timer = this.typingTimers.get(key)
      if (timer) clearTimeout(timer)
      await this.broadcastToConversation(conversationId, "chat.typing.changed", { conversationId, userId: state.userId, typing }, client)
      if (typing) {
        this.typingTimers.set(key, setTimeout(() => {
          this.typingTimers.delete(key)
          void this.broadcastToConversation(conversationId, "chat.typing.changed", { conversationId, userId: state.userId, typing: false })
        }, 5000))
      } else {
        this.typingLastSent.delete(key)
      }
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error)) }
  }

  private async readChat(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const conversationId = this.string(data.conversationId)
    const sequence = typeof data.sequence === "number" ? Math.floor(data.sequence) : Number(data.sequence)
    if (!conversationId || !Number.isFinite(sequence) || sequence < 0) return this.chatError(client, "INVALID_READ", "A valid conversation and sequence are required")
    try {
      await this.chats.markRead(state.userId, conversationId, sequence)
      await this.broadcastToConversation(conversationId, "chat.read.changed", { conversationId, userId: state.userId, sequence })
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error)) }
  }

  private async subscribeChatPresence(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const userId = this.string(data.userId)
    if (!userId) return this.chatError(client, "INVALID_PLAYER", "Player is required")
    try {
      await this.chats.authorizeFriendPresence(state.userId, userId)
      state.playerIds.add(userId)
      const player = await this.prisma.user.findUnique({ where: { id: userId }, select: { lastOnline: true } })
      this.send(client, "presence.snapshot", { userId, state: this.isOnline(userId) ? "ONLINE" : "OFFLINE", lastSeenAt: player?.lastOnline?.toISOString() ?? null })
    } catch (error) { this.chatError(client, this.chatErrorCode(error), this.errorMessage(error)) }
  }

  private async subscribeSupport(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const sessionId = this.string(data.sessionId)
    if (!sessionId) return this.send(client, "support.error", { code: "INVALID_SESSION", message: "Support session is required" })
    try {
      await this.supportLiveChat.authorizeSocket(state.userId, sessionId)
      state.supportSessionIds.add(sessionId)
      this.send(client, "support.ready", { sessionId })
    } catch (error) { this.send(client, "support.error", { code: "NOT_AUTHORIZED", message: this.errorMessage(error) }) }
  }

  private async supportTyping(client: WebSocket, state: ClientState, data: Record<string, unknown>, typing: boolean) {
    const sessionId = this.string(data.sessionId)
    if (!sessionId || !state.supportSessionIds.has(sessionId)) return this.send(client, "support.error", { code: "NOT_SUBSCRIBED", message: "Subscribe to the support session first" })
    try { await this.supportLiveChat.socketTypingAllowed(state.userId, sessionId); await this.broadcastSupportSession(sessionId, "support.typing.changed", { sessionId, userId: state.userId, typing }, client) }
    catch (error) { this.send(client, "support.error", { code: "NOT_AUTHORIZED", message: this.errorMessage(error) }) }
  }

  private async supportRead(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const sessionId = this.string(data.sessionId)
    const sequence = Number(data.sequence)
    if (!sessionId || !Number.isFinite(sequence)) return this.send(client, "support.error", { code: "INVALID_READ", message: "A valid session and sequence are required" })
    try { await this.supportLiveChat.markRead(state.userId, sessionId, Math.max(0, Math.floor(sequence))); await this.broadcastSupportSession(sessionId, "support.read.changed", { sessionId, userId: state.userId, sequence: Math.floor(sequence) }) }
    catch (error) { this.send(client, "support.error", { code: "NOT_AUTHORIZED", message: this.errorMessage(error) }) }
  }

  private async supportMessage(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const sessionId = this.string(data.sessionId)
    const clientMessageId = this.string(data.clientMessageId)
    const body = typeof data.body === "string" ? data.body : ""
    if (!sessionId || !clientMessageId) return this.send(client, "support.error", { code: "INVALID_MESSAGE", message: "Session and client message id are required", clientMessageId })
    try {
      const session = await this.supportLiveChat.authorizeSocket(state.userId, sessionId)
      const isAgent = session.playerId !== state.userId
      const message = isAgent ? await this.supportLiveChat.sendAgentMessage(state.userId, sessionId, { clientMessageId, body }) : await this.supportLiveChat.sendPlayerMessage(state.userId, sessionId, { clientMessageId, body })
      const created = (message as any).messages?.slice(-1)[0] ?? message
      this.send(client, "support.message.accepted", { sessionId, message: created })
      await this.broadcastSupportSession(sessionId, "support.message.created", { sessionId, message: created }, client)
    } catch (error) { this.send(client, "support.error", { code: "MESSAGE_REJECTED", message: this.errorMessage(error), clientMessageId }) }
  }

  private async broadcastToConversation(conversationId: string, event: string, data: unknown, exclude?: WebSocket) {
    const participantIds = await this.chats.participantIds(conversationId)
    for (const [client, state] of this.clients) {
      if (client === exclude || !participantIds.includes(state.userId)) continue
      this.send(client, event, data)
    }
  }

  private async broadcastSupportSession(sessionId: string, event: string, data: unknown, exclude?: WebSocket) {
    for (const [client, state] of this.clients) { if (client === exclude || !state.supportSessionIds.has(sessionId)) continue; this.send(client, event, data) }
  }

  private broadcastSupportQueue(event: string, data: unknown) { for (const [client, state] of this.clients) if (state.supportQueueSubscribed) this.send(client, event, data) }

  private async clearTypingForClient(state: ClientState) {
    for (const conversationId of state.chatConversationIds) {
      const key = `${conversationId}:${state.userId}`
      const timer = this.typingTimers.get(key)
      if (timer) clearTimeout(timer)
      this.typingTimers.delete(key)
      this.typingLastSent.delete(key)
      await this.broadcastToConversation(conversationId, "chat.typing.changed", { conversationId, userId: state.userId, typing: false })
    }
  }

  private chatError(client: WebSocket, code: string, message: string, clientMessageId?: string) {
    this.send(client, "chat.error", { code, message, ...(clientMessageId ? { clientMessageId } : {}) })
  }

  private string(value: unknown) { return typeof value === "string" ? value.trim() : "" }

  private errorMessage(error: unknown) {
    if (error && typeof error === "object" && "getResponse" in error) {
      const response = (error as { getResponse: () => unknown }).getResponse()
      if (typeof response === "object" && response && "message" in response) return String((response as { message: unknown }).message)
      if (typeof response === "string") return response
    }
    return error instanceof Error ? error.message : "Chat request failed"
  }

  private chatErrorCode(error: unknown) {
    const message = this.errorMessage(error).toLowerCase()
    if (message.includes("temporarily") || message.includes("disabled")) return "CHAT_DISABLED"
    if (message.includes("accepted friends")) return "NOT_FRIENDS"
    if (message.includes("blocked") || message.includes("unavailable")) return "CHAT_RESTRICTED"
    if (message.includes("limited to")) return "MESSAGE_TOO_LONG"
    if (message.includes("rate limit")) return "RATE_LIMITED"
    return "CHAT_ERROR"
  }

  private async publishChanges() {
    if (this.publishing) return
    this.publishing = true
    try {
      for (const [client, state] of this.clients) {
        if (client.readyState !== 1) { this.clients.delete(client); continue }
        if (state.queueSubscribed) await this.sendQueueSnapshot(client, state, false)
        for (const matchId of state.matchIds) await this.sendMatchSnapshot(client, state, matchId, false)
        if (state.supportQueueSubscribed) await this.sendSupportQueueSnapshot(client, state)
        for (const sessionId of state.supportSessionIds) await this.sendSupportSessionSnapshot(client, state, sessionId)
        for (const partyId of state.partyIds) await this.sendPartySnapshot(client, state, partyId)
      }
    } finally {
      this.publishing = false
    }
  }

  private async subscribeParty(client: WebSocket, state: ClientState, data: Record<string, unknown>) {
    const partyId = this.string(data.partyId)
    if (!partyId) return this.send(client, "party.error", { code: "INVALID_PARTY", message: "Party is required" })
    try { state.partyIds.add(partyId); await this.sendPartySnapshot(client, state, partyId, true) }
    catch (error) { this.send(client, "party.error", { code: "NOT_AUTHORIZED", message: this.errorMessage(error) }) }
  }

  private async sendPartySnapshot(client: WebSocket, state: ClientState, partyId: string, force = false) {
    try {
      const snapshot = await this.parties.authorizeParty(state.userId, partyId)
      const key = `party:${partyId}:${JSON.stringify(snapshot)}`
      if (!force && state.lastSnapshots.get(`party:${partyId}`) === key) return
      state.lastSnapshots.set(`party:${partyId}`, key)
      this.send(client, force ? "party.ready" : "party.snapshot", { party: snapshot })
    } catch {
      state.partyIds.delete(partyId)
      state.lastSnapshots.delete(`party:${partyId}`)
    }
  }

  private async sendQueueSnapshot(client: WebSocket, state: ClientState, force: boolean) {
    try {
      const snapshot = await this.matchmaking.status(state.userId)
      const key = `queue:${JSON.stringify(snapshot)}`
      if (!force && state.lastSnapshots.get("queue") === key) return
      state.lastSnapshots.set("queue", key)
      this.send(client, "queue.snapshot", snapshot)
    } catch { /* HTTP fallback remains available after a transient tick failure. */ }
  }

  private async sendSupportQueueSnapshot(client: WebSocket, state: ClientState) {
    try {
      const snapshot = await this.supportLiveChat.agentQueue(state.userId, { limit: 100, offset: 0 })
      const key = `support-queue:${JSON.stringify(snapshot)}`
      if (state.lastSnapshots.get("support-queue") === key) return
      state.lastSnapshots.set("support-queue", key)
      this.send(client, "support.queue.snapshot", snapshot)
    } catch { /* HTTP agent inbox remains available after transient errors. */ }
  }

  private async sendSupportSessionSnapshot(client: WebSocket, state: ClientState, sessionId: string) {
    try {
      const snapshot = await this.supportLiveChat.get(state.userId, sessionId, false)
      const key = `support-session:${sessionId}:${JSON.stringify(snapshot)}`
      if (state.lastSnapshots.get(`support-session:${sessionId}`) === key) return
      const previous = state.lastSnapshots.get(`support-session:${sessionId}`)
      state.lastSnapshots.set(`support-session:${sessionId}`, key)
      if (previous) this.send(client, "support.live-chat.status-changed", { sessionId, session: snapshot })
    } catch {
      state.supportSessionIds.delete(sessionId)
      state.lastSnapshots.delete(`support-session:${sessionId}`)
    }
  }

  private async sendMatchSnapshot(client: WebSocket, state: ClientState, matchId: string, force: boolean) {
    try {
      const game = await this.prisma.match.findUnique({ where: { id: matchId }, select: { gameDefinition: { select: { key: true } } } })
      if (game?.gameDefinition.key === "gem_blitz") {
        const snapshot = await this.gemBlitz.snapshot(state.userId, matchId)
        const key = JSON.stringify(snapshot)
        if (force || state.lastSnapshots.get(`gem-blitz:${matchId}`) !== key) {
          state.lastSnapshots.set(`gem-blitz:${matchId}`, key)
          this.send(client, "gem_blitz.snapshot", snapshot)
        }
        this.releaseFinishedMatch(client, state, matchId, snapshot)
        return
      }
      if (game?.gameDefinition.key === "tile_rush") {
        const snapshot = await this.tileRush.snapshot(state.userId, matchId)
        const key = JSON.stringify(snapshot)
        if (force || state.lastSnapshots.get(`tile-rush:${matchId}`) !== key) {
          state.lastSnapshots.set(`tile-rush:${matchId}`, key)
          this.send(client, "tile_rush.snapshot", snapshot)
        }
        this.releaseFinishedMatch(client, state, matchId, snapshot)
        return
      }
      const snapshot = await this.matches.get(matchId, state.userId)
      const key = JSON.stringify(snapshot)
      const cacheKey = `match:${matchId}`
      const previousSnapshotKey = state.lastSnapshots.get(cacheKey)
      const snapshotChanged = force || previousSnapshotKey !== key
      state.lastSnapshots.set(cacheKey, key)
      if (snapshotChanged) {
        this.send(client, "match.snapshot", snapshot)
        if (snapshot && typeof snapshot === "object" && "cooperative" in snapshot) this.send(client, "cooperative.match.snapshot", snapshot)
      }

      // Match reactions such as EMOTE are persisted events and do not change
      // the match projection. Do not return when the snapshot is unchanged;
      // otherwise an emote sent between two score updates is never delivered
      // to the opponent's subscribed socket.
      const recentEvents = await this.prisma.matchEvent.findMany({ where: { matchId, accepted: true }, orderBy: { serverReceivedAt: "desc" }, take: 20, select: { id: true, participantId: true, eventType: true, sequence: true, serverReceivedAt: true, payload: true } })
      const eventCacheKey = `events:${matchId}`
      const eventKey = recentEvents.map((event) => event.id).join(",")
      const previousEventKey = state.lastSnapshots.get(eventCacheKey)
      state.lastSnapshots.set(eventCacheKey, eventKey)
      if (previousEventKey && previousEventKey !== eventKey) {
        const previousIds = new Set(previousEventKey.split(","))
        for (const event of recentEvents.filter((item) => !previousIds.has(item.id)).reverse()) this.send(client, "match.event.accepted", { matchId, event: event.eventType === "EMOTE" ? event : { ...event, payload: undefined } })
      }
      const status = typeof (snapshot as { status?: unknown }).status === "string" ? (snapshot as { status: string }).status : ""
      if (status === "FINISHED" || status === "REVIEW" || status === "SETTLED") {
        this.send(client, "match.settled", { matchId, status })
        state.matchIds.delete(matchId)
        this.clearMatchSnapshots(state, matchId)
      }
    } catch {
      // Drop both the subscription and its serialized projection. A player
      // can play many matches on one socket; retaining every old board here
      // otherwise makes the per-client cache grow for the lifetime of the
      // connection.
      state.matchIds.delete(matchId)
      this.clearMatchSnapshots(state, matchId)
    }
  }

  private clearMatchSnapshots(state: ClientState, matchId: string) {
    state.lastSnapshots.delete(`gem-blitz:${matchId}`)
    state.lastSnapshots.delete(`tile-rush:${matchId}`)
    state.lastSnapshots.delete(`match:${matchId}`)
    state.lastSnapshots.delete(`events:${matchId}`)
  }

  private releaseFinishedMatch(client: WebSocket, state: ClientState, matchId: string, snapshot: unknown) {
    const status = snapshot && typeof snapshot === "object" && "status" in snapshot ? String((snapshot as { status?: unknown }).status ?? "") : ""
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(status)) return
    this.send(client, "match.settled", { matchId, status })
    state.matchIds.delete(matchId)
    this.clearMatchSnapshots(state, matchId)
  }

  private async broadcastGemBlitz(matchId: string) {
    const latest = await this.prisma.matchEvent.findFirst({ where: { matchId, eventType: "SCORE_UPDATE", accepted: true }, orderBy: { serverReceivedAt: "desc" }, select: { payload: true, participantId: true } })
    for (const [client, state] of this.clients) {
      if (!state.matchIds.has(matchId)) continue
      try {
        const ownParticipant = await this.prisma.matchParticipant.findFirst({ where: { matchId, userId: state.userId }, select: { id: true } })
        const move = latest && latest.participantId === ownParticipant?.id && latest.payload && typeof latest.payload === "object" && !Array.isArray(latest.payload)
          ? { ...(latest.payload as Record<string, unknown>), participantId: latest.participantId }
          : undefined
        const snapshot = await this.gemBlitz.snapshot(state.userId, matchId)
        this.send(client, "gem_blitz.snapshot", move ? { ...snapshot, move } : snapshot)
      } catch { /* HTTP reconciliation handles a disconnected match. */ }
    }
  }

  private async broadcastTileRush(matchId: string) {
    for (const [client, state] of this.clients) {
      if (!state.matchIds.has(matchId)) continue
      try {
        const snapshot = await this.tileRush.snapshot(state.userId, matchId)
        this.send(client, "tile_rush.snapshot", snapshot)
      } catch { /* HTTP reconcile remains available after a transient failure. */ }
    }
  }

  private readToken(request: IncomingMessage) {
    const authorization = request.headers.authorization
    if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim()
    const url = new URL(request.url ?? "/", "http://localhost")
    return url.searchParams.get("token")?.trim() ?? ""
  }

  private send(client: WebSocket, event: string, data: unknown) {
    if (client.readyState === 1) client.send(JSON.stringify({ event, data }))
  }

  private isOnline(userId: string) {
    for (const state of this.clients.values()) if (state.userId === userId) return true
    return false
  }

  private broadcastPresence(userId: string, online: boolean) {
    for (const [client, state] of this.clients) if (state.playerIds.has(userId)) this.send(client, "presence.changed", { userId, state: online ? "ONLINE" : "OFFLINE", lastSeenAt: online ? null : new Date().toISOString() })
  }
}
