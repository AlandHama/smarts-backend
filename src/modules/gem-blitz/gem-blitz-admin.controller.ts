import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { UpdateGemBlitzPolicyDto } from "./dtos/gem-blitz-admin.dto"

const defaults = { enabled: true, visibleName: "Gem Blitz", description: "Match fast. Think faster.", boardSize: 7, durationSeconds: 75, rulesVersion: "gem-blitz.v1", casualEnabled: true, rankedEnabled: true, bot: { enabled: true, reactionDelayMs: 1200, jitterMs: 900, skill: 0.62, maxMoves: 55 }, scoring: { scoreCap: 250000, feverThreshold: 5, feverMultiplier: 1.25, fastMoveWindowMs: 2500 }, rush: { finalRushSeconds: 10, rushSeconds: 25 } }

@ApiTags("System admin Gem Blitz")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class GemBlitzAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("api/gem-blitz/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: "gem_blitz" }, include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } } })
    if (!game) throw new BadRequestException("Gem Blitz is not configured")
    const active = game.configs.find((config) => config.active) ?? game.configs[0]
    const settings = active?.settings && typeof active.settings === "object" && !Array.isArray(active.settings) ? active.settings as Record<string, any> : {}
    return { definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy }, activeVersion: active?.version ?? null, policy: { ...defaults, ...(settings.gemBlitzPolicy ?? {}) }, versions: game.configs.map((config) => ({ id: config.id, version: config.version, active: config.active, createdAt: config.createdAt, policy: (config.settings as any)?.gemBlitzPolicy ?? null })) }
  }

  @Patch("api/gem-blitz/policy")
  async update(@Body() dto: UpdateGemBlitzPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = this.validate(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "gem_blitz" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Gem Blitz is not configured")
      const previous = game.configs[0]
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({ data: { gameDefinitionId: game.id, version: version + 1, active: true, mainProgressionKey: previous?.mainProgressionKey ?? "gem_blitz_xp", eloProgressionKey: previous?.eloProgressionKey ?? "gem_blitz_elo", rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD", scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1, maxEloDelta: previous?.maxEloDelta ?? 100, soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000, soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50, winnerBaseReward: previous?.winnerBaseReward ?? 0n, loserBaseReward: previous?.loserBaseReward ?? 0n, drawReward: previous?.drawReward ?? 0n, scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1, scoreRewardCap: previous?.scoreRewardCap ?? 0n, winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n, loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n, multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n, correctAnswerPoints: previous?.correctAnswerPoints ?? {}, wrongAnswerPenaltyPercent: previous?.wrongAnswerPenaltyPercent ?? 0, maxAnswerTimeSeconds: previous?.maxAnswerTimeSeconds ?? policy.durationSeconds, maxMatchDurationSeconds: policy.durationSeconds, maxQuestions: 0, instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n, rankingEnabled: policy.rankedEnabled, rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1, rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1, rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1, settings: { ...(previous?.settings as any ?? {}), authoritative: true, gemBlitzPolicy: policy } } })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: String(policy.visibleName), active: Boolean(policy.enabled), modePolicy: { ...policy, authoritative: true } } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "GEM_BLITZ_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: { version: config.version, policy } })
      return { version: config.version, active: true, policy }
    })
  }

  @Post("api/gem-blitz/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) {
    const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "gem_blitz" }, version }, include: { gameDefinition: true } })
    if (!source) throw new BadRequestException("Gem Blitz policy version not found")
    const policy = ((source.settings as any)?.gemBlitzPolicy ?? {}) as Record<string, unknown>
    return this.update({ policy: { ...defaults, ...policy }, reason: `Rollback to version ${version}` }, admin)
  }

  @Get("api/gem-blitz/operations")
  async operations() {
    const [active, settled, finished, bots, accepted, rejected, recentMatches] = await Promise.all([
      this.prisma.match.count({ where: { gameDefinition: { key: "gem_blitz" }, status: { in: ["CREATED", "STARTED"] } } }),
      this.prisma.match.count({ where: { gameDefinition: { key: "gem_blitz" }, status: "SETTLED" } }),
      this.prisma.match.count({ where: { gameDefinition: { key: "gem_blitz" }, status: { in: ["FINISHED", "REVIEW"] } } }),
      this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: { gameDefinition: { key: "gem_blitz" } } } }),
      this.prisma.matchEvent.count({ where: { eventType: "SCORE_UPDATE", accepted: true, match: { gameDefinition: { key: "gem_blitz" } } } }),
      this.prisma.matchEvent.count({ where: { eventType: "SCORE_UPDATE", accepted: false, match: { gameDefinition: { key: "gem_blitz" } } } }),
      this.prisma.match.findMany({ where: { gameDefinition: { key: "gem_blitz" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, mode: true, createdAt: true, startedAt: true, endedAt: true, settledAt: true, gameConfig: { select: { version: true } }, participants: { select: { participantType: true, finalScore: true, result: true } }, settlement: { select: { id: true } } } }),
    ])
    return { activeMatches: active, settledMatches: settled, finishedUnsettled: finished, botParticipants: bots, acceptedMoves: accepted, rejectedMoves: rejected, recentMatches, generatedAt: new Date().toISOString() }
  }

  private validate(input: Record<string, unknown>) {
    const policy: any = { ...defaults, ...input, bot: { ...defaults.bot, ...(input.bot as any ?? {}) }, scoring: { ...defaults.scoring, ...(input.scoring as any ?? {}) }, rush: { ...defaults.rush, ...(input.rush as any ?? {}) } }
    policy.boardSize = Number(policy.boardSize); policy.durationSeconds = Number(policy.durationSeconds)
    if (!Number.isInteger(policy.boardSize) || policy.boardSize < 5 || policy.boardSize > 9) throw new BadRequestException("Board size must be an integer from 5 to 9")
    if (!Number.isInteger(policy.durationSeconds) || policy.durationSeconds < 30 || policy.durationSeconds > 180) throw new BadRequestException("Duration must be between 30 and 180 seconds")
    if (Number(policy.bot.skill) < 0 || Number(policy.bot.skill) > 1 || Number(policy.bot.maxMoves) < 1 || Number(policy.scoring.scoreCap) < 1000) throw new BadRequestException("Bot skill, move limits, or score cap is unsafe")
    return policy
  }
}
