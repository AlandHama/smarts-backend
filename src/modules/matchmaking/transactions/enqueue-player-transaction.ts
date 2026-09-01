import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, MatchmakingTicketMode } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { EnqueuePlayerDto } from "../dtos"
import { queueHeartbeatTimeoutSeconds, queueTtlSeconds } from "../utilities/matchmaking-policy"

@Injectable()
export class EnqueuePlayerTransaction extends PrismaTransaction<{ userId: string; dto: EnqueuePlayerDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { userId: string; dto: EnqueuePlayerDto }, transaction: Prisma.TransactionClient) {
    const dto = input.dto
    const mode = dto.mode as MatchmakingTicketMode
    if (mode !== MatchmakingTicketMode.CASUAL && mode !== MatchmakingTicketMode.RANKED) throw new BadRequestException("Only casual and ranked queue modes are supported")
    const key = dto.idempotencyKey?.trim()
    const scope = `matchmaking:enqueue:${input.userId}`
    const requestHash = createHash("sha256").update(JSON.stringify({ gameKey: dto.gameKey.trim().toLowerCase(), mode, allowBotFallback: Boolean(dto.allowBotFallback), clientVersion: dto.clientVersion?.trim() || null, constraints: dto.constraints ?? null })).digest("hex")
    if (key) {
      const existing = await transaction.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } })
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException("The queue idempotency key was already used for another request")
        if (existing.status === "COMPLETED" && existing.responseJson) return existing.responseJson
        throw new ConflictException("The queue request is already being processed")
      }
    }

    const now = new Date()
    const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true, profile: { select: { level: true, elo: true, countryCode: true } } } })
    if (!user || user.status !== "ACTIVE") throw new BadRequestException("Player is not active")
    const game = await transaction.gameDefinition.findUnique({ where: { key: dto.gameKey.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const config = game?.configs[0]
    if (!game || !game.active || !config) throw new NotFoundException("Game definition or configuration is inactive")
    if (mode === MatchmakingTicketMode.RANKED && !config.rankingEnabled) throw new BadRequestException("Ranked matchmaking is disabled for this game")
    if (dto.constraints && (Object.keys(dto.constraints).length > 12 || JSON.stringify(dto.constraints).length > 2000)) throw new BadRequestException("Matchmaking constraints are too large")

    const current = await transaction.matchmakingTicket.findFirst({ where: { userId: input.userId, status: "SEARCHING" } })
    if (current) {
      if (current.expiresAt <= now || current.lastHeartbeatAt.getTime() <= now.getTime() - queueHeartbeatTimeoutSeconds() * 1000) await transaction.matchmakingTicket.update({ where: { id: current.id }, data: { status: "EXPIRED" } })
      else throw new ConflictException("Player is already in the matchmaking queue")
    }

    const idempotency = key ? await transaction.idempotencyKey.create({ data: { userId: input.userId, scope, key, requestHash, status: "PROCESSING" } }) : null
    const expiresAt = new Date(now.getTime() + queueTtlSeconds() * 1000)
    const ticket = await transaction.matchmakingTicket.create({ data: {
      userId: input.userId,
      gameDefinitionId: game.id,
      mode,
      isRankingMatch: mode === MatchmakingTicketMode.RANKED,
      levelSnapshot: user.profile?.level ?? 1,
      eloSnapshot: BigInt(user.profile?.elo ?? 1000),
      countryCodeSnapshot: user.profile?.countryCode?.trim().toUpperCase() || null,
      constraints: dto.constraints as Prisma.InputJsonValue | undefined,
      clientVersion: dto.clientVersion?.trim() || null,
      allowBotFallback: mode === MatchmakingTicketMode.CASUAL && Boolean(dto.allowBotFallback),
      expiresAt,
      lastHeartbeatAt: now,
      idempotencyKeyId: idempotency?.id,
    } })
    const response = { ticket: { id: ticket.id, status: ticket.status, mode: ticket.mode, gameKey: game.key, isRankingMatch: ticket.isRankingMatch, levelSnapshot: ticket.levelSnapshot, eloSnapshot: ticket.eloSnapshot.toString(), countryCodeSnapshot: ticket.countryCodeSnapshot, createdAt: ticket.createdAt, expiresAt: ticket.expiresAt, lastHeartbeatAt: ticket.lastHeartbeatAt, matchId: null } }
    if (idempotency) await transaction.idempotencyKey.update({ where: { id: idempotency.id }, data: { status: "COMPLETED", responseJson: response as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }
}
