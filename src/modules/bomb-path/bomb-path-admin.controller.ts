import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { Prisma } from "@prisma/client"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { DEFAULT_BOMB_PATH_POLICY, mergeBombPathPolicy } from "./engine/bomb-path-score"
import { UpdateBombPathPolicyDto } from "./dtos/bomb-path-admin.dto"
import { BombPathService } from "./bomb-path.service"

@ApiTags("System admin Bomb Path")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class BombPathAdminController {
  constructor(private readonly prisma: PrismaService, private readonly bombPath: BombPathService) {}

  @Get("api/bomb-path/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: "bomb_path" }, include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } } })
    if (!game) throw new BadRequestException("Bomb Path is not configured")
    const active = game.configs.find((item) => item.active) ?? game.configs[0]
    return { definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy }, activeVersion: active?.version ?? null, policy: mergeBombPathPolicy(this.object(this.object(active?.settings).bombPathPolicy)), versions: game.configs.map((item) => ({ id: item.id, version: item.version, active: item.active, createdAt: item.createdAt, policy: this.object(this.object(item.settings).bombPathPolicy) })) }
  }

  @Patch("api/bomb-path/policy")
  async update(@Body() dto: UpdateBombPathPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = mergeBombPathPolicy(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "bomb_path" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Bomb Path is not configured")
      const previous = game.configs[0]
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({ data: {
        gameDefinitionId: game.id, version: version + 1, active: true,
        mainProgressionKey: previous?.mainProgressionKey ?? "bomb_path_xp", eloProgressionKey: previous?.eloProgressionKey ?? "bomb_path_elo", rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD",
        scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1, maxEloDelta: previous?.maxEloDelta ?? 100, soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000, soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50,
        winnerBaseReward: previous?.winnerBaseReward ?? 0n, loserBaseReward: previous?.loserBaseReward ?? 0n, drawReward: previous?.drawReward ?? 0n, scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1, scoreRewardCap: previous?.scoreRewardCap ?? 250000n,
        winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n, loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n, multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n,
        correctAnswerPoints: previous?.correctAnswerPoints ?? {}, wrongAnswerPenaltyPercent: 0, maxAnswerTimeSeconds: Math.ceil(policy.playDurationMs / 1000), maxMatchDurationSeconds: policy.matchDurationSeconds, maxQuestions: 0,
        instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n, rankingEnabled: policy.rankedEnabled && !policy.killSwitch, rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1, rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1, rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1,
        settings: { ...(previous ? this.object(previous.settings) : {}), authoritative: true, bombPathPolicy: policy } as unknown as Prisma.InputJsonValue,
      } })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: policy.visibleName, active: policy.enabled && !policy.killSwitch, modePolicy: { ...policy, authoritative: true } as unknown as Prisma.InputJsonValue } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "BOMB_PATH_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: { version: config.version, policy } })
      return { version: config.version, active: true, policy }
    })
  }

  @Post("api/bomb-path/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) {
    const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "bomb_path" }, version } })
    if (!source) throw new BadRequestException("Bomb Path policy version not found")
    return this.update({ policy: { ...DEFAULT_BOMB_PATH_POLICY, ...this.object(this.object(source.settings).bombPathPolicy) }, reason: "Rollback to version " + version }, admin)
  }

  @Get("api/bomb-path/operations")
  async operations() {
    const where = { gameDefinition: { key: "bomb_path" } }
    const [active, created, finished, review, settled, unsettled, bots, events, rejected, recent] = await Promise.all([
      this.prisma.match.count({ where: { ...where, status: "STARTED" } }),
      this.prisma.match.count({ where: { ...where, status: "CREATED" } }),
      this.prisma.match.count({ where: { ...where, status: "FINISHED" } }),
      this.prisma.match.count({ where: { ...where, status: "REVIEW" } }),
      this.prisma.match.count({ where: { ...where, status: "SETTLED" } }),
      this.prisma.match.count({ where: { ...where, status: { in: ["FINISHED", "REVIEW"] }, settlement: null } }),
      this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: where } }),
      this.prisma.matchEvent.count({ where: { match: where, payload: { path: ["game"], equals: "bomb_path" } } }),
      this.prisma.matchEvent.count({ where: { match: where, accepted: false, payload: { path: ["game"], equals: "bomb_path" } } }),
      this.prisma.match.findMany({ where, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, status: true, mode: true, createdAt: true, startedAt: true, endedAt: true, gameConfig: { select: { version: true } }, participants: { select: { participantType: true, finalScore: true, result: true } }, settlement: { select: { id: true } } } }),
    ])
    return { activeMatches: active, createdMatches: created, finishedMatches: finished, reviewMatches: review, settledMatches: settled, unfinishedUnsettled: unsettled, botParticipants: bots, events, rejectedEvents: rejected, rejectionRate: events ? Math.round((rejected / events) * 10000) / 100 : 0, recentMatches: recent, generatedAt: new Date().toISOString() }
  }

  @Get("api/bomb-path/matches/:matchId/replay")
  async replay(@Param("matchId", ParseUUIDPipe) matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "bomb_path" } }, include: { gameConfig: { select: { version: true, settings: true } }, participants: { select: { id: true, userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }, events: { orderBy: { serverReceivedAt: "asc" }, take: 2000, select: { participantId: true, sequence: true, accepted: true, rejectionReason: true, payload: true, clientEventId: true, serverReceivedAt: true } }, settlement: true } })
    if (!match) throw new BadRequestException("Bomb Path match not found")
    return this.serialize({ match: { id: match.id, status: match.status, mode: match.mode, createdAt: match.createdAt, startedAt: match.startedAt, endedAt: match.endedAt, settledAt: match.settledAt, policyVersion: match.gameConfig.version }, state: (match.metadata as any)?.bombPath ?? null, participants: match.participants, events: match.events, settlement: match.settlement })
  }

  @Post("api/bomb-path/operations/:matchId/retry-settlement")
  async retrySettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) {
    const result = await this.bombPath.retrySettlement(matchId)
    await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "BOMB_PATH_SETTLEMENT_RETRY", entityType: "Match", entityId: matchId, reason: "Manual Bomb Path settlement retry", metadata: this.serialize({ result }) as Prisma.InputJsonValue } })
    return { matchId, result }
  }

  private object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {} }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
