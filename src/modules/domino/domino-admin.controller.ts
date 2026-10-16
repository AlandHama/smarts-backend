import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { Prisma } from "@prisma/client"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { DominoService } from "./domino.service"
import { UpdateDominoPolicyDto } from "./dtos/domino-admin.dto"

const defaults = { enabled: true, visibleName: "Domino Duel", seatCount: 4, handSize: 5, boneyardSize: 8, targetScore: 100, maxRounds: 10, roundDurationSeconds: 300, matchDurationSeconds: 900, botFillEnabled: true, botFallbackDelaySeconds: 20, botDifficulty: "NORMAL", casualEnabled: true, rankedEnabled: false, practiceEnabled: true, rankedBotFallback: false, rulesVersion: "domino.v1", scoreVersion: "domino-score.v1", maxActionsPerSecond: 8, maxDrawActionsPerTurn: 8, replayRetentionDays: 30 }

@ApiTags("System admin Domino")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class DominoAdminController {
  constructor(private readonly prisma: PrismaService, private readonly domino: DominoService) {}

  @Get("api/domino/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: "domino" }, include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } } })
    if (!game) throw new BadRequestException("Domino is not configured")
    const active = game.configs.find((item) => item.active) ?? game.configs[0]
    return { definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy }, activeVersion: active?.version ?? null, policy: this.merge(this.objectValue(active?.settings).dominoPolicy), versions: game.configs.map((item) => ({ id: item.id, version: item.version, active: item.active, createdAt: item.createdAt, policy: this.objectValue(this.objectValue(item.settings).dominoPolicy) })) }
  }

  @Patch("api/domino/policy")
  async update(@Body() dto: UpdateDominoPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = this.validate(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "domino" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Domino is not configured")
      const previous = game.configs[0]
      const previousPolicy: Record<string, any> = this.merge(this.objectValue(this.objectValue(previous?.settings).dominoPolicy))
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({ data: { gameDefinitionId: game.id, version: version + 1, active: true, mainProgressionKey: previous?.mainProgressionKey ?? "domino_xp", eloProgressionKey: previous?.eloProgressionKey ?? "domino_elo", rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD", scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1, maxEloDelta: previous?.maxEloDelta ?? 100, soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000, soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50, winnerBaseReward: previous?.winnerBaseReward ?? 0n, loserBaseReward: previous?.loserBaseReward ?? 0n, drawReward: previous?.drawReward ?? 0n, scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1, scoreRewardCap: previous?.scoreRewardCap ?? 0n, winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n, loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n, multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n, correctAnswerPoints: previous?.correctAnswerPoints ?? {}, wrongAnswerPenaltyPercent: previous?.wrongAnswerPenaltyPercent ?? 0, maxAnswerTimeSeconds: policy.roundDurationSeconds, maxMatchDurationSeconds: policy.matchDurationSeconds, maxQuestions: 0, instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n, rankingEnabled: policy.rankedEnabled, rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1, rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1, rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1, settings: { ...(previous ? this.objectValue(previous.settings) : {}), authoritative: true, dominoPolicy: policy } } })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: policy.visibleName, active: policy.enabled, modePolicy: { ...policy, authoritative: true } } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "DOMINO_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: { version: config.version, policy } })
      const diff = Object.keys({ ...previousPolicy, ...policy }).filter((key) => JSON.stringify(previousPolicy[key]) !== JSON.stringify(policy[key])).map((key) => ({ key, from: previousPolicy[key], to: policy[key] }))
      return { version: config.version, active: true, policy, diff }
    })
  }

  @Post("api/domino/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) { const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "domino" }, version } }); if (!source) throw new BadRequestException("Domino policy version not found"); return this.update({ policy: { ...this.merge(this.objectValue(this.objectValue(source.settings).dominoPolicy)), enabled: true }, reason: `Rollback to version ${version}` }, admin) }

  @Get("api/domino/operations")
  async operations() {
    const where = { gameDefinition: { key: "domino" } }
    const [activeMatches, waitingMatches, finishedMatches, reviewMatches, cancelledMatches, settledMatches, unsettledMatches, botParticipants, acceptedActions, rejectedActions, recentMatches, storage] = await Promise.all([
      this.prisma.match.count({ where: { ...where, status: "STARTED" } }), this.prisma.match.count({ where: { ...where, status: "CREATED" } }), this.prisma.match.count({ where: { ...where, status: "FINISHED" } }), this.prisma.match.count({ where: { ...where, status: "REVIEW" } }), this.prisma.match.count({ where: { ...where, status: "CANCELLED" } }), this.prisma.match.count({ where: { ...where, status: "SETTLED" } }), this.prisma.match.count({ where: { ...where, status: { in: ["FINISHED", "REVIEW"] }, settlement: null } }), this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: where } }), this.prisma.dominoAction.count({ where: { accepted: true } }), this.prisma.dominoAction.count({ where: { accepted: false } }), this.prisma.match.findMany({ where, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, mode: true, createdAt: true, startedAt: true, endedAt: true, settledAt: true, gameConfig: { select: { version: true } }, dominoMatch: { select: { roundNumber: true, currentSeat: true, chainHash: true, boneyardCount: true, state: true } }, participants: { select: { id: true, participantType: true, finalScore: true, result: true } }, settlement: { select: { id: true } } } }), this.tableStorage(),
    ])
    return { activeMatches, waitingMatches, finishedMatches, reviewMatches, cancelledMatches, settledMatches, unsettledMatches, botParticipants, acceptedActions, rejectedActions, rejectionRate: acceptedActions + rejectedActions ? Math.round(rejectedActions / (acceptedActions + rejectedActions) * 10000) / 100 : 0, recentMatches: recentMatches.map((match: any) => ({ ...match, dominoMatch: match.dominoMatch ? { ...match.dominoMatch, state: undefined } : null })), storage, generatedAt: new Date().toISOString(), runbook: { activePolicyChangesAreForwardOnly: true, replayHidesPrivateHands: true, settlementRetryIsIdempotent: true, incidentSteps: ["Disable new Domino matches with the policy kill switch", "Inspect the affected match and safe replay", "Verify chain hash, action rejection rate, and settlement status", "Retry settlement only after the provider/economy incident is resolved", "Record the incident and re-enable the policy"] } }
  }

  @Get("api/domino/analytics")
  async analytics(@Query("from") from?: string, @Query("to") to?: string) {
    const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date(); const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86400000); if (end <= start || end.getTime() - start.getTime() > 93 * 86400000) throw new BadRequestException("Analytics range must be positive and no longer than 93 days")
    const matches = await this.prisma.match.findMany({ where: { gameDefinition: { key: "domino" }, createdAt: { gte: start, lte: end } }, select: { id: true, status: true, mode: true, createdAt: true, participants: { select: { participantType: true, result: true } }, dominoMatch: { select: { state: true, boneyardCount: true } } } }); const ids = matches.map((item) => item.id); const actions = ids.length ? await this.prisma.dominoAction.groupBy({ by: ["accepted", "actionType"], where: { matchId: { in: ids } }, _count: { _all: true } }) : []; const series = new Map<string, any>(); for (const match of matches) { const day = match.createdAt.toISOString().slice(0, 10); const row = series.get(day) ?? { date: day, matches: 0, settled: 0, bots: 0 }; row.matches += 1; if (match.status === "SETTLED") row.settled += 1; row.bots += match.participants.filter((item) => item.participantType === "BOT").length; series.set(day, row) }
    const count = (accepted: boolean) => Number(actions.filter((item) => item.accepted === accepted).reduce((sum, item) => sum + item._count._all, 0)); return { range: { from: start.toISOString(), to: end.toISOString() }, totals: { matchesStarted: matches.length, matchesSettled: matches.filter((item) => item.status === "SETTLED").length, acceptedActions: count(true), rejectedActions: count(false), botFillRate: matches.length ? Math.round(matches.reduce((sum, item) => sum + item.participants.filter((p) => p.participantType === "BOT").length, 0) / matches.length / 3 * 10000) / 100 : 0 }, actionTypes: actions, series: [...series.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  }

  @Get("api/domino/matches/:matchId/replay")
  async replay(@Param("matchId", ParseUUIDPipe) matchId: string) { const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "domino" } }, include: { gameConfig: { select: { version: true, settings: true } }, dominoMatch: true, participants: { select: { id: true, userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } }, events: { orderBy: { serverReceivedAt: "asc" }, take: 2000, select: { participantId: true, sequence: true, accepted: true, rejectionReason: true, payload: true, clientEventId: true, serverReceivedAt: true } }, settlement: true } }); if (!match?.dominoMatch) throw new BadRequestException("Domino match not found"); const state = this.objectValue(match.dominoMatch.state); const publicState = { ...state, hands: undefined, boneyard: undefined }; const actions = await this.prisma.dominoAction.findMany({ where: { matchId }, orderBy: { serverReceivedAt: "asc" }, take: 2000 }); return { match: { id: match.id, status: match.status, mode: match.mode, createdAt: match.createdAt, startedAt: match.startedAt, endedAt: match.endedAt, settledAt: match.settledAt, policyVersion: match.gameConfig.version }, state: publicState, policy: this.objectValue(this.objectValue(match.gameConfig.settings).dominoPolicy), participants: match.participants, actions: actions.map((action) => ({ ...action, payload: action.payload })), events: match.events, settlement: match.settlement } }

  @Post("api/domino/operations/:matchId/retry-settlement")
  async retrySettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) { const result = await this.domino.retrySettlement(matchId); await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "DOMINO_SETTLEMENT_RETRY", entityType: "Match", entityId: matchId, reason: "Manual Domino settlement retry", metadata: JSON.parse(JSON.stringify({ result }, (_, value) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonValue } }); return { matchId, result } }

  @Post("api/domino/operations/:matchId/finalize-settlement")
  async finalizeSettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) { const result = await this.domino.retrySettlement(matchId); await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "DOMINO_SETTLEMENT_FINALIZE", entityType: "Match", entityId: matchId, reason: "Manual Domino settlement finalization", metadata: JSON.parse(JSON.stringify({ result }, (_, value) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonValue } }); return { matchId, result } }

  private merge(input: Record<string, any>) { return { ...defaults, ...input, seatCount: 4, handSize: 5, boneyardSize: 8 } }
  private validate(input: Record<string, unknown>) { const policy: any = this.merge(input as Record<string, any>); const integer = (key: string, min: number, max: number) => { const value = Number(policy[key]); if (!Number.isInteger(value) || value < min || value > max) throw new BadRequestException(`${key} must be an integer from ${min} to ${max}`); policy[key] = value }; integer("targetScore", 25, 500); integer("maxRounds", 1, 20); integer("roundDurationSeconds", 30, 900); integer("matchDurationSeconds", 60, 1800); integer("botFallbackDelaySeconds", 0, 300); integer("maxActionsPerSecond", 1, 8); integer("maxDrawActionsPerTurn", 1, 8); integer("replayRetentionDays", 1, 365); if (policy.matchDurationSeconds < policy.roundDurationSeconds) throw new BadRequestException("Match duration must be at least the round duration"); if (!/^domino\.v[0-9]+$/.test(String(policy.rulesVersion)) || !/^domino-score\.v[0-9]+$/.test(String(policy.scoreVersion))) throw new BadRequestException("Invalid Domino rules or scoring version"); if (!defaults.botDifficulty || !["EASY", "NORMAL", "HARD"].includes(String(policy.botDifficulty))) throw new BadRequestException("Invalid bot difficulty"); if (policy.rankedBotFallback) throw new BadRequestException("Ranked bot fallback is disabled for Domino V1"); return policy }
  private objectValue(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {} }
  private async tableStorage() { return this.prisma.$queryRaw<Array<{ relation: string; bytes: bigint }>>(Prisma.sql`SELECT relname AS relation, pg_total_relation_size(quote_ident(relname)::regclass) AS bytes FROM pg_class WHERE relname IN ('DominoMatchState', 'DominoAction')`).then((rows) => rows.map((row) => ({ relation: row.relation, bytes: row.bytes.toString() }))) }
}
