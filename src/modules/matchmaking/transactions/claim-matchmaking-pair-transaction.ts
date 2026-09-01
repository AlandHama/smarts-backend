import { Injectable } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { GameMode, MatchmakingTicketMode, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { botFallbackSeconds } from "../utilities/matchmaking-policy"

type TicketRow = {
  id: string
  userId: string
  gameDefinitionId: string
  mode: MatchmakingTicketMode
  isRankingMatch: boolean
  levelSnapshot: number
  eloSnapshot: bigint
  countryCodeSnapshot: string | null
  constraints: Prisma.JsonValue | null
  clientVersion: string | null
  allowBotFallback: boolean
  createdAt: Date
}

@Injectable()
export class ClaimMatchmakingPairTransaction extends PrismaTransaction<void, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const [{ locked }] = await transaction.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended('smarts-matchmaking-matcher', 0)) AS locked`
    if (!locked) return null

    const [first] = await transaction.$queryRaw<TicketRow[]>`
      SELECT "id", "userId", "gameDefinitionId", "mode", "isRankingMatch", "levelSnapshot", "eloSnapshot", "countryCodeSnapshot", "constraints", "clientVersion", "allowBotFallback", "createdAt"
      FROM "MatchmakingTicket"
      WHERE "status" = 'SEARCHING'
        AND "expiresAt" > NOW()
        AND "lastHeartbeatAt" > NOW() - make_interval(secs => ${this.heartbeatTimeoutSeconds()})
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `
    if (!first) return null

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - first.createdAt.getTime()) / 1000))
    const eloTolerance = Math.min(2000, 100 + Math.floor(elapsedSeconds / 30) * 100)
    const [second] = await transaction.$queryRaw<TicketRow[]>`
      SELECT "id", "userId", "gameDefinitionId", "mode", "isRankingMatch", "levelSnapshot", "eloSnapshot", "countryCodeSnapshot", "constraints", "clientVersion", "allowBotFallback", "createdAt"
      FROM "MatchmakingTicket"
      WHERE "status" = 'SEARCHING'
        AND "expiresAt" > NOW()
        AND "lastHeartbeatAt" > NOW() - make_interval(secs => ${this.heartbeatTimeoutSeconds()})
        AND "id" <> ${first.id}
        AND "userId" <> ${first.userId}
        AND "gameDefinitionId" = ${first.gameDefinitionId}
        AND "mode"::text = ${first.mode}
        AND "isRankingMatch" = ${first.isRankingMatch}
        AND ABS("eloSnapshot" - ${first.eloSnapshot}) <= ${eloTolerance}
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `

    if (!second && !(first.allowBotFallback && elapsedSeconds >= botFallbackSeconds())) return null
    const now = new Date()
    const game = await transaction.gameDefinition.findUnique({ where: { id: first.gameDefinitionId }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const config = game?.configs[0]
    if (!game || !config) return null

    const matchMode = second ? (first.mode === MatchmakingTicketMode.RANKED ? GameMode.RANKED : GameMode.CASUAL) : GameMode.BOT
    const match = await transaction.match.create({ data: {
      gameDefinitionId: game.id,
      gameConfigId: config.id,
      mode: matchMode,
      status: "CREATED",
      serverNonce: randomBytes(32).toString("base64url"),
      createdByUserId: first.userId,
      metadata: {
        source: second ? "MATCHMAKING_QUEUE" : "BOT_FALLBACK",
        isRankingMatch: first.isRankingMatch,
        queueTicketIds: second ? [first.id, second.id] : [first.id],
        serverSnapshots: [{ userId: first.userId, level: first.levelSnapshot, elo: first.eloSnapshot.toString(), countryCode: first.countryCodeSnapshot }, ...(second ? [{ userId: second.userId, level: second.levelSnapshot, elo: second.eloSnapshot.toString(), countryCode: second.countryCodeSnapshot }] : [])],
      } as Prisma.InputJsonValue,
    } })
    await transaction.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: game.id, status: "CREATED", challengeSeedHash: createHash("sha256").update(`${match.serverNonce}:1`).digest("hex") } })
    await transaction.matchParticipant.create({ data: { matchId: match.id, userId: first.userId, participantType: "PLAYER" } })
    if (second) await transaction.matchParticipant.create({ data: { matchId: match.id, userId: second.userId, participantType: "PLAYER" } })
    else await transaction.matchParticipant.create({ data: { matchId: match.id, participantType: "BOT", result: "PENDING" } })

    const ids = second ? [first.id, second.id] : [first.id]
    await transaction.matchmakingTicket.updateMany({ where: { id: { in: ids }, status: "SEARCHING" }, data: { status: "MATCHED", matchedAt: now, matchId: match.id } })
    return { ticketIds: ids, matchId: match.id, status: "MATCHED", matchStatus: match.status, gameKey: game.key, mode: matchMode }
  }

  private heartbeatTimeoutSeconds() {
    const value = Number(process.env.MATCHMAKING_HEARTBEAT_TIMEOUT_SECONDS)
    return Number.isFinite(value) && value >= 15 && value <= 600 ? Math.floor(value) : 45
  }
}
