import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { Prisma } from "@prisma/client"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { UpdateTileRushPolicyDto } from "./dtos/tile-rush-admin.dto"
import { TileRushService } from "./tile-rush.service"

const defaults = {
  enabled: true,
  visibleName: "Tile Rush",
  description: "Connect. Clear. Rush.",
  boardSize: 7,
  tileTypes: 5,
  durationSeconds: 60,
  minimumChain: 3,
  rulesVersion: "tile-rush.v1",
  connectionMode: "ORTHOGONAL",
  comboWindowMs: 2000,
  maxComboBonus: 0.2,
  finalRushSeconds: 10,
  finalRushMultiplier: 1.1,
  special5Threshold: 5,
  special7Threshold: 7,
  prismThreshold: 10,
  loopsEnabled: true,
  loopMinimumLength: 4,
  casualEnabled: true,
  rankedEnabled: true,
  rankedBotFallback: false,
  scoreCap: 250000,
  maxActionsPerSecond: 8,
  bot: { enabled: true, reactionDelayMs: 1700, jitterMs: 900, skill: 0.32, maxActions: 32, errorRate: 0.28 },
  scoring: { scoreCap: 250000, cascadeMultipliers: [0.5, 0.65, 0.8, 1], refillCascadeLimit: 6, chainTable: {}, specialBonuses: {} },
}

@ApiTags("System admin Tile Rush")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class TileRushAdminController {
  constructor(private readonly prisma: PrismaService, private readonly tileRush: TileRushService) {}

  @Get("api/tile-rush/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({
      where: { key: "tile_rush" },
      include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } },
    })
    if (!game) throw new BadRequestException("Tile Rush is not configured")
    const active = game.configs.find((config) => config.active) ?? game.configs[0]
    const settings = this.objectValue(active?.settings)
    return {
      definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy },
      activeVersion: active?.version ?? null,
      policy: this.mergePolicy(this.objectValue(settings.tileRushPolicy)),
      versions: game.configs.map((config) => ({
        id: config.id,
        version: config.version,
        active: config.active,
        createdAt: config.createdAt,
        policy: this.objectValue(this.objectValue(config.settings).tileRushPolicy),
      })),
    }
  }

  @Patch("api/tile-rush/policy")
  async update(@Body() dto: UpdateTileRushPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = this.validate(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "tile_rush" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Tile Rush is not configured")
      const previous = game.configs[0]
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({
        data: {
          gameDefinitionId: game.id,
          version: version + 1,
          active: true,
          mainProgressionKey: previous?.mainProgressionKey ?? "tile_rush_xp",
          eloProgressionKey: previous?.eloProgressionKey ?? "tile_rush_elo",
          rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD",
          scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1,
          maxEloDelta: previous?.maxEloDelta ?? 100,
          soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000,
          soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50,
          winnerBaseReward: previous?.winnerBaseReward ?? 0n,
          loserBaseReward: previous?.loserBaseReward ?? 0n,
          drawReward: previous?.drawReward ?? 0n,
          scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1,
          scoreRewardCap: previous?.scoreRewardCap ?? 0n,
          winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n,
          loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n,
          multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n,
          correctAnswerPoints: previous?.correctAnswerPoints ?? {},
          wrongAnswerPenaltyPercent: previous?.wrongAnswerPenaltyPercent ?? 0,
          maxAnswerTimeSeconds: policy.durationSeconds,
          maxMatchDurationSeconds: policy.durationSeconds,
          maxQuestions: 0,
          instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n,
          rankingEnabled: policy.rankedEnabled,
          rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1,
          rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1,
          rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1,
          settings: { ...(previous ? this.objectValue(previous.settings) : {}), authoritative: true, tileRushPolicy: policy },
        },
      })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: String(policy.visibleName), active: Boolean(policy.enabled), modePolicy: { ...policy, authoritative: true } } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "TILE_RUSH_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: { version: config.version, policy } })
      return { version: config.version, active: true, policy }
    })
  }

  @Post("api/tile-rush/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) {
    const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "tile_rush" }, version } })
    if (!source) throw new BadRequestException("Tile Rush policy version not found")
    const policy = this.objectValue(this.objectValue(source.settings).tileRushPolicy)
    return this.update({ policy: { ...this.mergePolicy(policy), enabled: true }, reason: `Rollback to version ${version}` }, admin)
  }

  @Get("api/tile-rush/operations")
  async operations() {
    const gameWhere = { gameDefinition: { key: "tile_rush" } }
    const [active, searching, finished, review, cancelled, settled, unsettled, bots, actionTotals, analytics, recentMatches] = await Promise.all([
      this.prisma.match.count({ where: { ...gameWhere, status: "STARTED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "CREATED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "FINISHED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "REVIEW" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "CANCELLED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "SETTLED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: { in: ["FINISHED", "REVIEW"] }, settlement: null } }),
      this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: gameWhere } }),
      this.prisma.$queryRaw<Array<{ accepted: bigint; rejected: bigint }>>(Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN "eventName" = 'TILE_RUSH_PATH_ACCEPTED' THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN "eventName" = 'TILE_RUSH_MATCH_FINISHED' THEN COALESCE(("properties"->>'acceptedActions')::bigint, 0) ELSE 0 END), 0) AS accepted,
          COALESCE(SUM(CASE WHEN "eventName" = 'TILE_RUSH_PATH_REJECTED' THEN 1 ELSE 0 END), 0)
            + COALESCE(SUM(CASE WHEN "eventName" = 'TILE_RUSH_MATCH_FINISHED' THEN COALESCE(("properties"->>'rejectedActions')::bigint, 0) ELSE 0 END), 0) AS rejected
        FROM "AnalyticsEvent"
      `),
      this.prisma.analyticsEvent.findMany({ where: { eventName: { startsWith: "TILE_RUSH_" } }, orderBy: { occurredAt: "desc" }, take: 500, select: { eventName: true, properties: true, occurredAt: true } }),
      this.prisma.match.findMany({ where: gameWhere, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, status: true, mode: true, createdAt: true, startedAt: true, endedAt: true, settledAt: true, gameConfig: { select: { version: true, settings: true } }, participants: { select: { participantType: true, finalScore: true, result: true } }, settlement: { select: { id: true } } } }),
    ])
    const accepted = Number(actionTotals[0]?.accepted ?? 0)
    const rejected = Number(actionTotals[0]?.rejected ?? 0)
    const specialCounts = analytics.filter((event) => event.eventName === "TILE_RUSH_SPECIAL_CREATED" || event.eventName === "TILE_RUSH_COLOR_CRUSH").reduce((result, event) => { result[event.eventName] = (result[event.eventName] ?? 0) + 1; return result }, {} as Record<string, number>)
    const comboValues = analytics.map((event) => this.objectValue(event.properties).combo).filter((value): value is number => typeof value === "number")
    const acceptedEvents = analytics.filter((event) => event.eventName === "TILE_RUSH_PATH_ACCEPTED")
    const rejectedEvents = analytics.filter((event) => event.eventName === "TILE_RUSH_PATH_REJECTED")
    const chainValues = acceptedEvents.map((event) => Number(this.objectValue(event.properties).chainLength)).filter((value) => Number.isFinite(value) && value > 0)
    const rejectionReasons = rejectedEvents.reduce((result, event) => { const reason = String(this.objectValue(event.properties).reason ?? "unknown"); result[reason] = (result[reason] ?? 0) + 1; return result }, {} as Record<string, number>)
    const hashMismatches = analytics.filter((event) => event.eventName === "TILE_RUSH_BOARD_HASH_MISMATCH").length
    const settlementRetryFailures = analytics.filter((event) => event.eventName === "TILE_RUSH_SETTLEMENT_RETRY_FAILED").length
    const botSkillDistribution = recentMatches.flatMap((match) => {
      const settings = this.objectValue(match.gameConfig?.settings)
      const skill = Number(this.objectValue(this.objectValue(settings.tileRushPolicy).bot).skill)
      return Number.isFinite(skill) ? [skill] : []
    }).reduce((result, skill) => { const bucket = skill < .25 ? "0.00–0.24" : skill < .5 ? "0.25–0.49" : skill < .75 ? "0.50–0.74" : "0.75–1.00"; result[bucket] = (result[bucket] ?? 0) + 1; return result }, {} as Record<string, number>)
    const serializedMatches = recentMatches.map((match) => ({ ...match, participants: match.participants.map((participant) => ({ ...participant, finalScore: participant.finalScore?.toString() ?? null })) }))
    return { activeMatches: active, searchingMatches: searching, finishedMatches: finished, reviewMatches: review, cancelledMatches: cancelled, settledMatches: settled, unfinishedUnsettled: unsettled, settlementRetryFailures, botParticipants: bots, botSkillDistribution, acceptedActions: accepted, rejectedActions: rejected, specialCounts, maxCombo: comboValues.length ? Math.max(...comboValues) : 0, averageChain: chainValues.length ? Math.round((chainValues.reduce((sum, value) => sum + value, 0) / chainValues.length) * 100) / 100 : 0, bestChain: chainValues.length ? Math.max(...chainValues) : 0, rejectionReasons, boardHashMismatches: hashMismatches, recentMatches: serializedMatches, generatedAt: new Date().toISOString() }
  }

  @Get("api/tile-rush/analytics")
  async analytics(@Query("from") from?: string, @Query("to") to?: string, @Query("mode") mode?: string) {
    const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date()
    const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86400000)
    if (end <= start || end.getTime() - start.getTime() > 93 * 86400000) throw new BadRequestException("Analytics range must be positive and no longer than 93 days")
    const matchIds = mode
      ? (await this.prisma.match.findMany({ where: { gameDefinition: { key: "tile_rush" }, mode: mode as any, createdAt: { gte: start, lte: end } }, select: { id: true } })).map((match) => match.id)
      : undefined
    const events = await this.prisma.analyticsEvent.findMany({ where: { eventName: { startsWith: "TILE_RUSH_" }, occurredAt: { gte: start, lte: end }, ...(matchIds ? { matchId: { in: matchIds } } : {}) }, select: { eventName: true, occurredAt: true, properties: true, matchId: true } })
    const byDay = new Map<string, { date: string; matches: number; accepted: number; rejected: number; specials: number; combos: number; settled: number }>()
    for (const event of events) {
      const date = event.occurredAt.toISOString().slice(0, 10)
      const row = byDay.get(date) ?? { date, matches: 0, accepted: 0, rejected: 0, specials: 0, combos: 0, settled: 0 }
      const properties = this.objectValue(event.properties)
      if (event.eventName === "TILE_RUSH_MATCH_STARTED") row.matches += 1
      if (event.eventName === "TILE_RUSH_PATH_ACCEPTED") row.accepted += 1
      if (event.eventName === "TILE_RUSH_PATH_REJECTED") row.rejected += 1
      if (event.eventName === "TILE_RUSH_SPECIAL_CREATED" || event.eventName === "TILE_RUSH_COLOR_CRUSH") row.specials += 1
      if (event.eventName === "TILE_RUSH_COMBO_REACHED") row.combos += 1
      if (event.eventName === "TILE_RUSH_MATCH_FINISHED") {
        row.accepted += Number(properties.acceptedActions ?? 0)
        row.rejected += Number(properties.rejectedActions ?? 0)
        row.specials += Number(properties.specials ?? 0)
        row.combos += Number(properties.combos ?? 0)
      }
      if (event.eventName === "TILE_RUSH_MATCH_SETTLED") row.settled += 1
      byDay.set(date, row)
    }
    const started = events.filter((event) => event.eventName === "TILE_RUSH_MATCH_STARTED").length
    const settledCount = events.filter((event) => event.eventName === "TILE_RUSH_MATCH_SETTLED").length
    const summaries = events.filter((event) => event.eventName === "TILE_RUSH_MATCH_FINISHED").map((event) => this.objectValue(event.properties))
    const accepted = events.filter((event) => event.eventName === "TILE_RUSH_PATH_ACCEPTED").length + summaries.reduce((total, properties) => total + Number(properties.acceptedActions ?? 0), 0)
    const rejected = events.filter((event) => event.eventName === "TILE_RUSH_PATH_REJECTED").length + summaries.reduce((total, properties) => total + Number(properties.rejectedActions ?? 0), 0)
    const combos = events.map((event) => this.objectValue(event.properties).combo).filter((value): value is number => typeof value === "number")
    const paths = events.filter((event) => event.eventName === "TILE_RUSH_PATH_ACCEPTED")
    const chains = paths.map((event) => Number(this.objectValue(event.properties).chainLength)).filter((value) => Number.isFinite(value) && value > 0)
    const specials = events.filter((event) => event.eventName === "TILE_RUSH_SPECIAL_CREATED" || event.eventName === "TILE_RUSH_COLOR_CRUSH").length + summaries.reduce((total, properties) => total + Number(properties.specials ?? 0), 0)
    const mismatch = events.filter((event) => event.eventName === "TILE_RUSH_BOARD_HASH_MISMATCH").length + summaries.reduce((total, properties) => total + Number(properties.boardHashMismatches ?? 0), 0)
    const chainBuckets = chains.reduce((result, value) => { const bucket = value >= 10 ? "10+" : value >= 7 ? "7-9" : value >= 5 ? "5-6" : "3-4"; result[bucket] = (result[bucket] ?? 0) + 1; return result }, {} as Record<string, number>)
    return { range: { from: start.toISOString(), to: end.toISOString(), mode: mode ?? null }, totals: { matchesStarted: started, matchesSettled: settledCount, settlementRate: started ? Math.round((settledCount / started) * 10000) / 100 : 0, acceptedActions: accepted, rejectedActions: rejected, rejectionRate: accepted + rejected ? Math.round((rejected / (accepted + rejected)) * 10000) / 100 : 0, maxCombo: combos.length ? Math.max(...combos) : 0, averageChain: chains.length ? Math.round((chains.reduce((sum, value) => sum + value, 0) / chains.length) * 100) / 100 : 0, specialRate: accepted ? Math.round((specials / accepted) * 10000) / 100 : 0, boardHashMismatches: mismatch }, dimensions: { chainBuckets }, series: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  }

  @Get("api/tile-rush/matches/:matchId/replay")
  async replay(@Param("matchId", ParseUUIDPipe) matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "tile_rush" } }, include: { gameConfig: { select: { version: true, settings: true } }, participants: { select: { id: true, userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } }, events: { orderBy: { serverReceivedAt: "asc" }, take: 500, select: { participantId: true, sequence: true, accepted: true, rejectionReason: true, payload: true, clientEventId: true, serverReceivedAt: true, requestHash: true } }, settlement: true } })
    if (!match) throw new BadRequestException("Tile Rush match not found")
    const metadata = this.objectValue(match.metadata)
    const state = this.objectValue(metadata.tileRush)
    return { match: { id: match.id, status: match.status, mode: match.mode, createdAt: match.createdAt, startedAt: match.startedAt, endedAt: match.endedAt, settledAt: match.settledAt, policyVersion: match.gameConfig.version }, policy: this.objectValue(this.objectValue(match.gameConfig.settings).tileRushPolicy), players: match.participants, replay: state.replay ?? [], events: match.events, settlement: match.settlement }
  }

  @Post("api/tile-rush/operations/:matchId/retry-settlement")
  async retrySettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) {
    const result = await this.tileRush.retrySettlement(matchId)
    await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "TILE_RUSH_SETTLEMENT_RETRY", entityType: "Match", entityId: matchId, reason: "Manual Tile Rush settlement retry", metadata: { result: this.json(result) } as Prisma.InputJsonValue } })
    return { matchId, result }
  }

  @Post("api/tile-rush/operations/:matchId/review")
  async review(@Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: { reason?: string }, @CurrentUser() admin: UserResponseDto) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "tile_rush" } }, select: { id: true, status: true } })
    if (!match) throw new BadRequestException("Tile Rush match not found")
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.match.update({ where: { id: matchId }, data: { status: "REVIEW" } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "TILE_RUSH_MATCH_FLAGGED_REVIEW", entityType: "Match", entityId: matchId, reason: body?.reason, metadata: { previousStatus: match.status } })
      return value
    })
    return { id: updated.id, status: updated.status }
  }

  private mergePolicy(input: Record<string, any>) {
    return { ...defaults, ...input, bot: { ...defaults.bot, ...(input.bot ?? {}) }, scoring: { ...defaults.scoring, ...(input.scoring ?? {}) } }
  }

  private validate(input: Record<string, unknown>) {
    const policy: any = this.mergePolicy(input as Record<string, any>)
    const integer = (value: unknown, min: number, max: number, label: string) => { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new BadRequestException(`${label} must be an integer from ${min} to ${max}`); return number }
    const decimal = (value: unknown, min: number, max: number, label: string) => { const number = Number(value); if (!Number.isFinite(number) || number < min || number > max) throw new BadRequestException(`${label} must be between ${min} and ${max}`); return number }
    policy.boardSize = integer(policy.boardSize, 5, 9, "Board size")
    policy.tileTypes = integer(policy.tileTypes, 3, 8, "Tile types")
    policy.durationSeconds = integer(policy.durationSeconds, 30, 180, "Duration")
    policy.minimumChain = integer(policy.minimumChain, 3, 5, "Minimum chain")
    policy.comboWindowMs = integer(policy.comboWindowMs, 250, 10000, "Combo window")
    policy.finalRushSeconds = integer(policy.finalRushSeconds, 0, Math.min(30, policy.durationSeconds), "Final rush seconds")
    policy.loopMinimumLength = integer(policy.loopMinimumLength, 4, policy.boardSize * policy.boardSize, "Loop minimum length")
    policy.special5Threshold = integer(policy.special5Threshold, policy.minimumChain, 81, "Special-5 threshold")
    policy.special7Threshold = integer(policy.special7Threshold, policy.special5Threshold, 81, "Special-7 threshold")
    policy.prismThreshold = integer(policy.prismThreshold, policy.special7Threshold, 81, "Prism threshold")
    policy.scoreCap = integer(policy.scoreCap, 1000, 10000000, "Score cap")
    policy.maxActionsPerSecond = integer(policy.maxActionsPerSecond, 1, 20, "Maximum actions per second")
    policy.maxComboBonus = decimal(policy.maxComboBonus, 0, 0.2, "Maximum combo bonus")
    policy.finalRushMultiplier = decimal(policy.finalRushMultiplier, 0.5, 2, "Final rush multiplier")
    policy.bot.reactionDelayMs = integer(policy.bot.reactionDelayMs, 400, 5000, "Bot reaction delay")
    policy.bot.jitterMs = integer(policy.bot.jitterMs, 0, 5000, "Bot jitter")
    policy.bot.maxActions = integer(policy.bot.maxActions, 1, 80, "Bot maximum actions")
    policy.bot.skill = decimal(policy.bot.skill, 0, 1, "Bot skill")
    policy.bot.errorRate = decimal(policy.bot.errorRate, 0, 0.8, "Bot error rate")
    policy.scoring.scoreCap = integer(policy.scoring.scoreCap ?? policy.scoreCap, 1000, 10000000, "Scoring score cap")
    policy.scoring.refillCascadeLimit = integer(policy.scoring.refillCascadeLimit, 1, 12, "Refill cascade limit")
    if (policy.loopsEnabled && policy.loopMinimumLength < policy.minimumChain + 1) throw new BadRequestException("Loop minimum length must leave room for a distinct chain")
    if (policy.scoring.cascadeMultipliers && (!Array.isArray(policy.scoring.cascadeMultipliers) || policy.scoring.cascadeMultipliers.length > 12 || policy.scoring.cascadeMultipliers.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 5))) throw new BadRequestException("Cascade multipliers are unsafe")
    if (policy.rankedBotFallback && !policy.rankedEnabled) throw new BadRequestException("Ranked bot fallback requires ranked mode to be enabled")
    if (typeof policy.rulesVersion !== "string" || !/^tile-rush\.v[0-9]+$/.test(policy.rulesVersion)) throw new BadRequestException("Rules version must use tile-rush.vN format")
    return policy
  }

  private objectValue(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {} }
  private json(value: unknown) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
