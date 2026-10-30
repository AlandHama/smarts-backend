import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { GameMode, Prisma, MatchmakingTicketMode } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { EnqueuePlayerDto } from "../dtos"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { forfeitCooldownSeconds, forfeitStrikeThreshold, forfeitStrikeWindowSeconds, queueHeartbeatTimeoutSeconds, queueTtlSeconds } from "../utilities/matchmaking-policy"
import { MatchIntegrityPolicyService } from "../../matches/match-integrity-policy.service"
import { isAuthoritativeBoardGame } from "../../matches/utilities/server-content"

@Injectable()
export class EnqueuePlayerTransaction extends PrismaTransaction<{ userId: string; dto: EnqueuePlayerDto }, any> {
  constructor(prisma: PrismaService, private readonly debitWallet: DebitWalletTransaction, private readonly creditWallet: CreditWalletTransaction, private readonly integrityPolicy: MatchIntegrityPolicyService) { super(prisma) }

  protected async execute(input: { userId: string; dto: EnqueuePlayerDto }, transaction: Prisma.TransactionClient) {
    const dto = input.dto
    const mode = dto.mode as MatchmakingTicketMode
    if (mode !== MatchmakingTicketMode.CASUAL && mode !== MatchmakingTicketMode.RANKED) throw new BadRequestException("Only casual and ranked queue modes are supported")
    const requestedGameKey = dto.gameKey.trim().toLowerCase()
    const randomCasual = requestedGameKey === "random"
    if (randomCasual && mode !== MatchmakingTicketMode.CASUAL) throw new BadRequestException("Random game selection is only available for casual matchmaking")
    const key = dto.idempotencyKey?.trim()
    const scope = `matchmaking:enqueue:${input.userId}`
    const requestHash = createHash("sha256").update(JSON.stringify({ gameKey: dto.gameKey.trim().toLowerCase(), mode, allowBotFallback: Boolean(dto.allowBotFallback), rankingConfigId: dto.rankingConfigId ?? null, clientVersion: dto.clientVersion?.trim() || null, constraints: dto.constraints ?? null })).digest("hex")
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
    const fraudProfile = await transaction.fraudProfile.findUnique({ where: { userId: input.userId }, select: { status: true, score: true } })
    const rewardsHeld = Boolean(fraudProfile && fraudProfile.score >= 60)
    const rewardsRestricted = fraudProfile?.status === "RESTRICTED" || fraudProfile?.status === "SUSPENDED"
    if (mode === MatchmakingTicketMode.RANKED && (rewardsHeld || rewardsRestricted)) throw new ConflictException("Ranked matchmaking is unavailable while reward integrity is under review")
    const strikeThreshold = forfeitStrikeThreshold()
    const forfeits = await transaction.matchParticipant.findMany({
      where: {
        userId: input.userId,
        result: "FORFEIT",
        submittedAt: { gte: new Date(now.getTime() - forfeitStrikeWindowSeconds() * 1000) },
      },
      orderBy: { submittedAt: "desc" },
      take: strikeThreshold,
      select: { submittedAt: true },
    })
    const latestForfeitAt = forfeits[0]?.submittedAt
    const cooldownDuration = forfeitCooldownSeconds()
    if (forfeits.length >= strikeThreshold && latestForfeitAt) {
      const cooldownEndsAt = new Date(latestForfeitAt.getTime() + cooldownDuration * 1000)
      if (cooldownEndsAt > now) {
        const remainingSeconds = Math.ceil((cooldownEndsAt.getTime() - now.getTime()) / 1000)
        throw new ConflictException(`Please wait ${remainingSeconds} seconds before joining another match after ${strikeThreshold} forfeits`)
      }
    }
    const playerLevel = user.profile?.level ?? 1
    // MatchmakingTicket keeps a required game relation for legacy/reporting
    // compatibility. Random casual tickets use a valid active game as a
    // placeholder; the matcher replaces it with a server-selected game after
    // two random tickets are paired.
    const game = randomCasual
      ? await transaction.gameDefinition.findFirst({
          where: { active: true, configs: { some: { active: true, minimumPlayerLevel: { lte: playerLevel } } }, OR: [{ key: "gem_blitz" }, { key: "tile_rush" }, { key: "word_dash" }, { key: "domino" }, { key: "perfect_timing" }, { key: "bomb_path" }, { content: { some: { active: true } } }] },
          orderBy: { key: "asc" },
          include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } },
        })
      : await transaction.gameDefinition.findUnique({ where: { key: requestedGameKey }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const config = game?.configs[0]
    if (!game || !game.active || !config) throw new NotFoundException("Game definition or configuration is inactive")
    await this.integrityPolicy.assertAvailable(game.key, mode as unknown as GameMode, [input.userId], transaction)
    const progressionKeys = [...new Set([config.mainProgressionKey, config.eloProgressionKey])]
    const validProgressions = await transaction.progressionDefinition.findMany({ where: { key: { in: progressionKeys }, active: true, tiers: { some: { step: 1, pointsThreshold: 0n } } }, select: { key: true } })
    if (validProgressions.length !== progressionKeys.length) throw new ConflictException("This game reward configuration is incomplete")
    if (playerLevel < config.minimumPlayerLevel) throw new ConflictException(`Reach level ${config.minimumPlayerLevel} to unlock ${game.name}`)
    const activeContentCount = await transaction.gameContentItem.count({ where: { gameDefinitionId: game.id, active: true } })
    if (!activeContentCount && !isAuthoritativeBoardGame(game.key)) throw new ConflictException("No active server content is configured for this game")
    if (mode === MatchmakingTicketMode.RANKED && !config.rankingEnabled) throw new BadRequestException("Ranked matchmaking is disabled for this game")
    const configuredPolicy = config.settings && typeof config.settings === "object" && !Array.isArray(config.settings) ? (config.settings as Record<string, any>)[game.key === "word_dash" ? "wordDashPolicy" : game.key === "tile_rush" ? "tileRushPolicy" : game.key === "domino" ? "dominoPolicy" : game.key === "perfect_timing" ? "perfectTimingPolicy" : game.key === "bomb_path" ? "bombPathPolicy" : ""] : null
    if (game.key === "perfect_timing" && configuredPolicy && (configuredPolicy.killSwitch === true || !inPerfectTimingRollout(input.userId, Number(configuredPolicy.rolloutPercentage ?? 100)))) throw new ConflictException("Perfect Timing is not available in the current rollout")
    if (game.key === "bomb_path" && configuredPolicy && (configuredPolicy.killSwitch === true || !inPerfectTimingRollout(input.userId, Number(configuredPolicy.rolloutPercentage ?? 100)))) throw new ConflictException("Bomb Path is not available in the current rollout")
    if ((game.key === "tile_rush" || game.key === "word_dash" || game.key === "domino" || game.key === "perfect_timing" || game.key === "bomb_path") && configuredPolicy && ((mode === MatchmakingTicketMode.CASUAL && configuredPolicy.casualEnabled === false) || (mode === MatchmakingTicketMode.RANKED && configuredPolicy.rankedEnabled === false))) throw new ConflictException(`This ${game.name} mode is currently disabled`)
    if ((game.key === "tile_rush" || game.key === "word_dash" || game.key === "perfect_timing" || game.key === "bomb_path") && mode === MatchmakingTicketMode.RANKED && Boolean(dto.allowBotFallback) && configuredPolicy?.rankedBotFallback !== true) throw new BadRequestException(`${game.name} ranked matchmaking does not allow bot fallback`)
    let rankingConfig: { id: string; name: string; stakeAmountGld: bigint; entryFeeGld: bigint; entryFeeGldMicros: bigint } | null = null
    if (mode === MatchmakingTicketMode.RANKED) {
      rankingConfig = await transaction.rankingMatchConfig.findFirst({
        where: { ...(dto.rankingConfigId ? { id: dto.rankingConfigId } : {}), enabled: true },
        select: { id: true, name: true, stakeAmountGld: true, entryFeeGld: true, entryFeeGldMicros: true },
        orderBy: { sortOrder: "asc" },
      })
      if (!rankingConfig) throw new BadRequestException("Ranking entry tier is unavailable")
      const feeMicros = rankingConfig.entryFeeGldMicros || rankingConfig.entryFeeGld * 1_000_000n
      if (rankingConfig.stakeAmountGld <= 0n || feeMicros < 0n || feeMicros >= rankingConfig.stakeAmountGld * 1_000_000n) throw new BadRequestException("Ranking entry tier is invalid")
    }
    const queueConstraints = randomCasual
      ? { ...(dto.constraints ?? {}), randomGame: true }
      : dto.constraints
    if (queueConstraints && (Object.keys(queueConstraints).length > 12 || JSON.stringify(queueConstraints).length > 2000)) throw new BadRequestException("Matchmaking constraints are too large")

    // Serialize queue creation per player. Without this lock two quick taps
    // or two app retries can both observe no ticket and leave duplicate
    // SEARCHING rows that later get matched independently.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`
    const currentTickets = await transaction.matchmakingTicket.findMany({
      where: {
        userId: input.userId,
        OR: [
          { status: "SEARCHING" },
          { status: "MATCHED", match: { is: { status: { in: ["CREATED", "STARTED"] } } } },
        ],
      },
      orderBy: { createdAt: "desc" },
    })
    const heartbeatCutoff = now.getTime() - queueHeartbeatTimeoutSeconds() * 1000
    const activeTickets = []
    for (const current of currentTickets) {
      if (current.status === "SEARCHING" && (current.expiresAt <= now || current.lastHeartbeatAt.getTime() <= heartbeatCutoff)) {
        await transaction.matchmakingTicket.update({ where: { id: current.id }, data: { status: "EXPIRED" } })
        if (current.rankingStakeAmount && !current.rankingRefundedAt) {
          await this.creditWallet.runWithinTransaction({
            userId: input.userId,
            currencyCode: "GLD",
            amount: current.rankingStakeAmount,
            sourceId: `${current.id}:expire-refund`,
            sourceType: "RANKING_MATCH_REFUND",
            metadata: { ticketId: current.id, reason: "ranking_queue_expired_before_retry" },
          }, transaction)
          await transaction.matchmakingTicket.update({ where: { id: current.id }, data: { rankingRefundedAt: now } })
        }
        continue
      }
      activeTickets.push(current)
    }
    if (activeTickets.some((ticket) => ticket.status === "MATCHED")) {
      throw new ConflictException("Player already has an active match")
    }
    if (activeTickets.length) {
      throw new ConflictException("Player is already in the matchmaking queue")
    }

    const idempotency = key ? await transaction.idempotencyKey.create({ data: { userId: input.userId, scope, key, requestHash, status: "PROCESSING" } }) : null
    const expiresAt = new Date(now.getTime() + queueTtlSeconds() * 1000)
    const configuredBotFallback = mode === MatchmakingTicketMode.CASUAL && (Boolean(dto.allowBotFallback) || game.key === "domino" || (game.key === "perfect_timing" && configuredPolicy?.casualBotEnabled === true) || (game.key === "bomb_path" && configuredPolicy?.casualBotEnabled === true))
    const ticket = await transaction.matchmakingTicket.create({ data: {
      userId: input.userId,
      gameDefinitionId: game.id,
      mode,
      isRankingMatch: mode === MatchmakingTicketMode.RANKED,
      levelSnapshot: user.profile?.level ?? 1,
      eloSnapshot: BigInt(user.profile?.elo ?? 1000),
      countryCodeSnapshot: user.profile?.countryCode?.trim().toUpperCase() || null,
      constraints: queueConstraints as Prisma.InputJsonValue | undefined,
      clientVersion: dto.clientVersion?.trim() || null,
      allowBotFallback: configuredBotFallback && !rewardsHeld && !rewardsRestricted,
      rankingConfigId: rankingConfig?.id,
      rankingStakeAmount: rankingConfig?.stakeAmountGld,
      rankingEntryFee: rankingConfig?.entryFeeGld,
      rankingEntryFeeMicros: rankingConfig ? (rankingConfig.entryFeeGldMicros || rankingConfig.entryFeeGld * 1_000_000n) : undefined,
      expiresAt,
      lastHeartbeatAt: now,
      idempotencyKeyId: idempotency?.id,
    } })
    if (rankingConfig) {
      await this.debitWallet.runWithinTransaction({
        userId: input.userId,
        currencyCode: "GLD",
        amount: rankingConfig.stakeAmountGld,
        sourceId: ticket.id,
        sourceType: "RANKING_MATCH_ENTRY",
        metadata: { rankingConfigId: rankingConfig.id, stakeAmountGld: rankingConfig.stakeAmountGld.toString(), entryFeeGld: rankingConfig.entryFeeGld.toString(), entryFeeGldMicros: (rankingConfig.entryFeeGldMicros || rankingConfig.entryFeeGld * 1_000_000n).toString() },
      }, transaction)
    }
    if (game.key === "tile_rush" || game.key === "word_dash" || game.key === "domino" || game.key === "perfect_timing" || game.key === "bomb_path") {
      await transaction.analyticsEvent.create({
        data: {
          eventName: game.key === "word_dash" ? "WORD_DASH_QUEUE_JOINED" : game.key === "tile_rush" ? "TILE_RUSH_QUEUE_JOINED" : game.key === "domino" ? "DOMINO_QUEUE_JOINED" : game.key === "perfect_timing" ? "PERFECT_TIMING_QUEUE_JOINED" : "BOMB_PATH_QUEUE_JOINED",
          occurredAt: now,
          playerId: input.userId,
          properties: { mode, ranked: mode === MatchmakingTicketMode.RANKED, allowBotFallback: ticket.allowBotFallback } as Prisma.InputJsonValue,
        },
      })
    }
    const response = { ticket: { id: ticket.id, status: ticket.status, mode: ticket.mode, gameKey: game.key, isRankingMatch: ticket.isRankingMatch, rankingConfigId: ticket.rankingConfigId, rankingStakeAmount: ticket.rankingStakeAmount?.toString() ?? null, rankingEntryFee: ticket.rankingEntryFee?.toString() ?? null, rankingEntryFeeMicros: ticket.rankingEntryFeeMicros?.toString() ?? null, levelSnapshot: ticket.levelSnapshot, eloSnapshot: ticket.eloSnapshot.toString(), countryCodeSnapshot: ticket.countryCodeSnapshot, createdAt: ticket.createdAt, expiresAt: ticket.expiresAt, lastHeartbeatAt: ticket.lastHeartbeatAt, matchId: null } }
    if (idempotency) await transaction.idempotencyKey.update({ where: { id: idempotency.id }, data: { status: "COMPLETED", responseJson: response as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }
}

function inPerfectTimingRollout(userId: string, percentage: number): boolean {
  if (percentage >= 100) return true
  if (percentage <= 0) return false
  const bucket = createHash("sha256").update(`perfect-timing-rollout:${userId}`).digest("hex").slice(0, 8)
  return (Number.parseInt(bucket, 16) / 0xffffffff) * 100 < percentage
}
