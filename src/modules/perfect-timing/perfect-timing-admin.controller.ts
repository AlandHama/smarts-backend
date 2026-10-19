import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { Prisma } from "@prisma/client"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { DEFAULT_PERFECT_TIMING_POLICY, mergePerfectTimingPolicy } from "./engine/perfect-timing-score"
import { UpdatePerfectTimingPolicyDto } from "./dtos/perfect-timing-admin.dto"
import { PerfectTimingService } from "./perfect-timing.service"

@ApiTags("System admin Perfect Timing")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class PerfectTimingAdminController {
  constructor(private readonly prisma: PrismaService, private readonly perfectTiming: PerfectTimingService) {}

  @Get("api/perfect-timing/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: "perfect_timing" }, include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } } })
    if (!game) throw new BadRequestException("Perfect Timing is not configured")
    const active = game.configs.find((item) => item.active) ?? game.configs[0]
    return this.serialize({ definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy }, activeVersion: active?.version ?? null, policy: mergePerfectTimingPolicy(this.objectValue(this.objectValue(active?.settings).perfectTimingPolicy)), versions: game.configs.map((item) => ({ id: item.id, version: item.version, active: item.active, createdAt: item.createdAt, policy: this.objectValue(this.objectValue(item.settings).perfectTimingPolicy) })) })
  }

  @Patch("api/perfect-timing/policy")
  async update(@Body() dto: UpdatePerfectTimingPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = mergePerfectTimingPolicy(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "perfect_timing" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Perfect Timing is not configured")
      const previous = game.configs[0]
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({ data: {
        gameDefinitionId: game.id, version: version + 1, active: true,
        mainProgressionKey: previous?.mainProgressionKey ?? "perfect_timing_xp", eloProgressionKey: previous?.eloProgressionKey ?? "perfect_timing_elo", rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD",
        scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1, maxEloDelta: previous?.maxEloDelta ?? 100, soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000, soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50,
        winnerBaseReward: previous?.winnerBaseReward ?? 0n, loserBaseReward: previous?.loserBaseReward ?? 0n, drawReward: previous?.drawReward ?? 0n, scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1, scoreRewardCap: previous?.scoreRewardCap ?? 250000n,
        winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n, loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n, multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n,
        correctAnswerPoints: { PERFECT: 100, GREAT: 75, GOOD: 40, MISS: 0 }, wrongAnswerPenaltyPercent: 0, maxAnswerTimeSeconds: Math.ceil(policy.roundDurationMs / 1000), maxMatchDurationSeconds: Math.ceil((policy.rankedRoundMax * (policy.roundDurationMs + policy.interRoundDurationMs)) / 1000), maxQuestions: 0,
        instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n, rankingEnabled: policy.rankedEnabled && !policy.killSwitch, rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1, rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1, rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1,
        settings: this.jsonValue({ ...(previous ? this.objectValue(previous.settings) : {}), authoritative: true, perfectTimingPolicy: policy }),
      } })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: policy.visibleName, active: policy.enabled && !policy.killSwitch, modePolicy: this.jsonValue({ ...policy, authoritative: true }) } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "PERFECT_TIMING_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: this.jsonValue({ version: config.version, policy }) as Record<string, unknown> })
      return this.serialize({ version: config.version, active: true, policy })
    })
  }

  @Post("api/perfect-timing/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) {
    const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "perfect_timing" }, version } })
    if (!source) throw new BadRequestException("Perfect Timing policy version not found")
    return this.update({ policy: { ...DEFAULT_PERFECT_TIMING_POLICY, ...this.objectValue(this.objectValue(source.settings).perfectTimingPolicy) }, reason: `Rollback to version ${version}` }, admin)
  }

  @Get("api/perfect-timing/operations")
  async operations() {
    const gameWhere = { gameDefinition: { key: "perfect_timing" } }
    const [active, created, finished, settled, unsettled, bots, actions, accepted, rejected, judgementRows] = await Promise.all([
      this.prisma.match.count({ where: { ...gameWhere, status: "STARTED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "CREATED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "FINISHED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "SETTLED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: { in: ["FINISHED", "REVIEW"] }, settlement: null } }),
      this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: gameWhere } }),
      this.prisma.perfectTimingAction.count({ where: { match: gameWhere } }),
      this.prisma.perfectTimingAction.count({ where: { match: gameWhere, accepted: true } }),
      this.prisma.perfectTimingAction.count({ where: { match: gameWhere, accepted: false } }),
      this.prisma.perfectTimingAction.groupBy({ by: ["judgement"], where: { match: gameWhere, accepted: true }, _count: { _all: true } }),
    ])
    return { activeMatches: active, createdMatches: created, finishedMatches: finished, settledMatches: settled, unfinishedUnsettled: unsettled, botParticipants: bots, actions, acceptedActions: accepted, rejectedActions: rejected, rejectionRate: actions ? Math.round((rejected / actions) * 10000) / 100 : 0, judgements: judgementRows.map((item) => ({ judgement: item.judgement, count: item._count._all })), generatedAt: new Date().toISOString() }
  }

  @Get("api/perfect-timing/matches/:matchId/replay")
  async replay(@Param("matchId", ParseUUIDPipe) matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "perfect_timing" } }, include: { gameConfig: { select: { version: true, settings: true } }, perfectTimingMatch: true, participants: { select: { id: true, userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } }, events: { orderBy: { serverReceivedAt: "asc" }, take: 2000, select: { participantId: true, sequence: true, accepted: true, rejectionReason: true, payload: true, clientEventId: true, serverReceivedAt: true } }, settlement: true } })
    if (!match?.perfectTimingMatch) throw new BadRequestException("Perfect Timing match not found")
    const actions = await this.prisma.perfectTimingAction.findMany({ where: { matchId }, orderBy: { serverReceivedAt: "asc" } })
    return this.serialize({ match: { id: match.id, status: match.status, mode: match.mode, createdAt: match.createdAt, startedAt: match.startedAt, endedAt: match.endedAt, settledAt: match.settledAt, policyVersion: match.gameConfig.version }, state: match.perfectTimingMatch, players: match.participants, actions, events: match.events, settlement: match.settlement })
  }

  @Post("api/perfect-timing/operations/:matchId/retry-settlement")
  async retrySettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) {
    const result = await this.perfectTiming.retrySettlement(matchId)
    await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "PERFECT_TIMING_SETTLEMENT_RETRY", entityType: "Match", entityId: matchId, reason: "Manual Perfect Timing settlement retry", metadata: this.serialize({ result }) as Prisma.InputJsonValue } })
    return { matchId, result }
  }

  private objectValue(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {} }
  private jsonValue(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
