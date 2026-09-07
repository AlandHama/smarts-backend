import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { WebSocketGateway } from "@nestjs/websockets"
import { IncomingMessage } from "node:http"
import { URL } from "node:url"
import { MatchmakingService } from "../matchmaking/matchmaking.service"
import { MatchService } from "../matches/match.service"
import { PrismaService } from "../../prisma.service"
import { getAuthConfig } from "../auth/auth.config"
import type { JwtPayload } from "../auth/dtos/jwt-payload.dto"
import type { WebSocket } from "ws"

type ClientState = {
  userId: string
  matchIds: Set<string>
  playerIds: Set<string>
  queueSubscribed: boolean
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
  private readonly timer: NodeJS.Timeout

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly matches: MatchService,
    private readonly matchmaking: MatchmakingService,
  ) {
    this.timer = setInterval(() => void this.publishChanges(), 1000)
    this.timer.unref()
  }

  handleConnection(client: WebSocket, request: IncomingMessage) {
    void this.authenticate(client, request)
  }

  handleDisconnect(client: WebSocket) {
    const state = this.clients.get(client)
    this.clients.delete(client)
    if (state && !this.isOnline(state.userId)) this.broadcastPresence(state.userId, false)
  }

  onModuleDestroy() {
    clearInterval(this.timer)
    for (const client of this.clients.keys()) client.close(1001, "Server shutting down")
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

      const state: ClientState = { userId: user.id, matchIds: new Set(), playerIds: new Set([user.id]), queueSubscribed: false, lastSnapshots: new Map() }
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
      await this.sendMatchSnapshot(client, state, matchId, true)
      return
    }
    if (event === "unsubscribe_match") {
      if (typeof data.matchId === "string") state.matchIds.delete(data.matchId)
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
    this.send(client, "error", { message: "Unknown event" })
  }

  private async publishChanges() {
    for (const [client, state] of this.clients) {
      if (client.readyState !== 1) { this.clients.delete(client); continue }
      if (state.queueSubscribed) await this.sendQueueSnapshot(client, state, false)
      for (const matchId of state.matchIds) await this.sendMatchSnapshot(client, state, matchId, false)
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

  private async sendMatchSnapshot(client: WebSocket, state: ClientState, matchId: string, force: boolean) {
    try {
      const snapshot = await this.matches.get(matchId, state.userId)
      const key = JSON.stringify(snapshot)
      const cacheKey = `match:${matchId}`
      if (!force && state.lastSnapshots.get(cacheKey) === key) return
      state.lastSnapshots.set(cacheKey, key)
      this.send(client, "match.snapshot", snapshot)
      const recentEvents = await this.prisma.matchEvent.findMany({ where: { matchId, accepted: true }, orderBy: { serverReceivedAt: "desc" }, take: 20, select: { id: true, participantId: true, eventType: true, sequence: true, serverReceivedAt: true } })
      const eventCacheKey = `events:${matchId}`
      const eventKey = recentEvents.map((event) => event.id).join(",")
      const previousEventKey = state.lastSnapshots.get(eventCacheKey)
      state.lastSnapshots.set(eventCacheKey, eventKey)
      if (previousEventKey && previousEventKey !== eventKey) {
        const previousIds = new Set(previousEventKey.split(","))
        for (const event of recentEvents.filter((item) => !previousIds.has(item.id)).reverse()) this.send(client, "match.event.accepted", { matchId, event })
      }
      const status = typeof (snapshot as { status?: unknown }).status === "string" ? (snapshot as { status: string }).status : ""
      if (status === "FINISHED" || status === "REVIEW" || status === "SETTLED") this.send(client, "match.settled", { matchId, status })
    } catch { /* An unauthorized/deleted match is harmless on a later tick. */ }
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
    for (const [client, state] of this.clients) if (state.playerIds.has(userId)) this.send(client, "presence.changed", { userId, state: online ? "ONLINE" : "OFFLINE" })
  }
}
