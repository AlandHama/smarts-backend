import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { Prisma } from "@prisma/client"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { PrismaService } from "../../prisma.service"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { UpdateWordDashPolicyDto } from "./dtos/word-dash-admin.dto"
import { WordDashDictionary } from "./engine/word-dash-dictionary"
import { DEFAULT_WORD_DASH_POLICY } from "./engine/word-dash-score"
import { WordDashService } from "./word-dash.service"

@ApiTags("System admin Word Dash")
@ApiBearerAuth("access-token")
@Controller("system-admin")
@UseGuards(SystemAdminGuard)
export class WordDashAdminController {
  constructor(private readonly prisma: PrismaService, private readonly wordDash: WordDashService, private readonly dictionary: WordDashDictionary) {}

  @Get("api/word-dash/policy")
  async policy() {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: "word_dash" }, include: { configs: { orderBy: { version: "desc" }, select: { id: true, version: true, active: true, settings: true, createdAt: true } } } })
    if (!game) throw new BadRequestException("Word Dash is not configured")
    const active = game.configs.find((item) => item.active) ?? game.configs[0]
    const settings = this.objectValue(active?.settings)
    return {
      definition: { id: game.id, key: game.key, name: game.name, active: game.active, modePolicy: game.modePolicy },
      activeVersion: active?.version ?? null,
      dictionary: { version: this.dictionary.version, sha256: this.dictionary.sha256, words: this.dictionary.size, checksumConfigured: Boolean(process.env.WORD_DASH_DICTIONARY_SHA256) },
      policy: this.mergePolicy(this.objectValue(settings.wordDashPolicy)),
      versions: game.configs.map((item) => ({ id: item.id, version: item.version, active: item.active, createdAt: item.createdAt, policy: this.objectValue(this.objectValue(item.settings).wordDashPolicy) })),
    }
  }

  @Patch("api/word-dash/policy")
  async update(@Body() dto: UpdateWordDashPolicyDto, @CurrentUser() admin: UserResponseDto) {
    const policy = this.validate(dto.policy)
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.gameDefinition.findUnique({ where: { key: "word_dash" }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
      if (!game) throw new BadRequestException("Word Dash is not configured")
      const previous = game.configs[0]
      const version = (await tx.gameConfig.aggregate({ where: { gameDefinitionId: game.id }, _max: { version: true } }))._max.version ?? 0
      if (previous) await tx.gameConfig.update({ where: { id: previous.id }, data: { active: false } })
      const config = await tx.gameConfig.create({ data: {
        gameDefinitionId: game.id, version: version + 1, active: true,
        mainProgressionKey: previous?.mainProgressionKey ?? "word_dash_xp", eloProgressionKey: previous?.eloProgressionKey ?? "word_dash_elo", rewardCurrencyCode: previous?.rewardCurrencyCode ?? "GLD",
        scoreMultiplierForXp: previous?.scoreMultiplierForXp ?? 1, maxEloDelta: previous?.maxEloDelta ?? 100, soloEloScoreDivisor: previous?.soloEloScoreDivisor ?? 1000, soloEloMaxDelta: previous?.soloEloMaxDelta ?? 50,
        winnerBaseReward: previous?.winnerBaseReward ?? 0n, loserBaseReward: previous?.loserBaseReward ?? 0n, drawReward: previous?.drawReward ?? 0n, scoreRewardDivisor: previous?.scoreRewardDivisor ?? 1, scoreRewardCap: previous?.scoreRewardCap ?? 0n,
        winnerRewardBonusMax: previous?.winnerRewardBonusMax ?? 0n, loserRewardBonusMax: previous?.loserRewardBonusMax ?? 0n, multiplayerRewardReference: previous?.multiplayerRewardReference ?? 0n,
        correctAnswerPoints: previous?.correctAnswerPoints ?? {}, wrongAnswerPenaltyPercent: previous?.wrongAnswerPenaltyPercent ?? 0, maxAnswerTimeSeconds: policy.durationSeconds, maxMatchDurationSeconds: policy.durationSeconds, maxQuestions: 0,
        instantSkipPriceGld: previous?.instantSkipPriceGld ?? 0n, rankingEnabled: policy.rankedEnabled, rankingEloMultiplier: previous?.rankingEloMultiplier ?? 1, rankingLevelMultiplier: previous?.rankingLevelMultiplier ?? 1, rankingCoinMultiplier: previous?.rankingCoinMultiplier ?? 1,
        settings: { ...(previous ? this.objectValue(previous.settings) : {}), authoritative: true, wordDashPolicy: policy },
      } })
      await tx.gameDefinition.update({ where: { id: game.id }, data: { name: policy.visibleName, active: policy.enabled, modePolicy: { ...policy, authoritative: true } } })
      await writeAdminAudit(tx, { actorId: admin.id, action: "WORD_DASH_POLICY_UPDATED", entityType: "GameConfig", entityId: config.id, reason: dto.reason, metadata: { version: config.version, policy, dictionarySha256: this.dictionary.sha256 } })
      return { version: config.version, active: true, policy, dictionary: { version: this.dictionary.version, sha256: this.dictionary.sha256 } }
    })
  }

  @Post("api/word-dash/policy/rollback/:version")
  async rollback(@Param("version", ParseIntPipe) version: number, @CurrentUser() admin: UserResponseDto) {
    const source = await this.prisma.gameConfig.findFirst({ where: { gameDefinition: { key: "word_dash" }, version } })
    if (!source) throw new BadRequestException("Word Dash policy version not found")
    const policy = this.objectValue(this.objectValue(source.settings).wordDashPolicy)
    return this.update({ policy: { ...this.mergePolicy(policy), enabled: true }, reason: `Rollback to version ${version}` }, admin)
  }

  @Get("api/word-dash/operations")
  async operations() {
    const gameWhere = { gameDefinition: { key: "word_dash" } }
    const [active, searching, finished, review, cancelled, settled, unsettled, bots, submissions, accepted, rejected, recentMatches, storage] = await Promise.all([
      this.prisma.match.count({ where: { ...gameWhere, status: "STARTED" } }), this.prisma.match.count({ where: { ...gameWhere, status: "CREATED" } }), this.prisma.match.count({ where: { ...gameWhere, status: "FINISHED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: "REVIEW" } }), this.prisma.match.count({ where: { ...gameWhere, status: "CANCELLED" } }), this.prisma.match.count({ where: { ...gameWhere, status: "SETTLED" } }),
      this.prisma.match.count({ where: { ...gameWhere, status: { in: ["FINISHED", "REVIEW"] }, settlement: null } }), this.prisma.matchParticipant.count({ where: { participantType: "BOT", match: gameWhere } }),
      this.prisma.wordDashSubmission.count({}), this.prisma.wordDashSubmission.count({ where: { accepted: true } }), this.prisma.wordDashSubmission.count({ where: { accepted: false } }),
      this.prisma.match.findMany({ where: gameWhere, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, mode: true, createdAt: true, startedAt: true, endedAt: true, settledAt: true, gameConfig: { select: { version: true } }, participants: { select: { participantType: true, finalScore: true, result: true } }, settlement: { select: { id: true } } } }),
      this.prisma.$queryRaw<Array<{ relation: string; bytes: bigint }>>(Prisma.sql`SELECT relname AS relation, pg_total_relation_size(quote_ident(relname)::regclass) AS bytes FROM pg_class WHERE relname IN ('WordDashMatch', 'WordDashParticipantState', 'WordDashFoundWord', 'WordDashSubmission')`),
    ])
    const state = await this.prisma.wordDashParticipantState.aggregate({ _avg: { score: true, acceptedWordCount: true, longestWordLength: true }, _max: { score: true, longestWordLength: true } })
    return { activeMatches: active, searchingMatches: searching, finishedMatches: finished, reviewMatches: review, cancelledMatches: cancelled, settledMatches: settled, unfinishedUnsettled: unsettled, botParticipants: bots, submissions, acceptedSubmissions: accepted, rejectedSubmissions: rejected, rejectionRate: submissions ? Math.round((rejected / submissions) * 10000) / 100 : 0, averageScore: Math.round(state._avg.score ?? 0), averageWordsPerPlayer: Math.round((state._avg.acceptedWordCount ?? 0) * 100) / 100, averageLongestWord: Math.round((state._avg.longestWordLength ?? 0) * 100) / 100, bestScore: state._max.score ?? 0, bestLongestWord: state._max.longestWordLength ?? 0, storage: storage.map((item) => ({ relation: item.relation, bytes: item.bytes.toString() })), generatedAt: new Date().toISOString() }
  }

  @Get("api/word-dash/analytics")
  async analytics(@Query("from") from?: string, @Query("to") to?: string) {
    const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date(); const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86400000)
    if (end <= start || end.getTime() - start.getTime() > 93 * 86400000) throw new BadRequestException("Analytics range must be positive and no longer than 93 days")
    const matches = await this.prisma.match.findMany({ where: { gameDefinition: { key: "word_dash" }, createdAt: { gte: start, lte: end } }, select: { id: true, status: true, mode: true, createdAt: true } })
    const ids = matches.map((item) => item.id)
    const rows = ids.length ? await this.prisma.wordDashSubmission.groupBy({ by: ["accepted"], where: { matchId: { in: ids } }, _count: { _all: true } }) : []
    const byDay = new Map<string, { date: string; matches: number; accepted: number; rejected: number; settled: number }>()
    for (const match of matches) { const date = match.createdAt.toISOString().slice(0, 10); const row = byDay.get(date) ?? { date, matches: 0, accepted: 0, rejected: 0, settled: 0 }; row.matches += 1; if (match.status === "SETTLED") row.settled += 1; byDay.set(date, row) }
    return { range: { from: start.toISOString(), to: end.toISOString() }, totals: { matchesStarted: matches.length, matchesSettled: matches.filter((item) => item.status === "SETTLED").length, acceptedSubmissions: Number(rows.find((item) => item.accepted)?._count._all ?? 0), rejectedSubmissions: Number(rows.find((item) => !item.accepted)?._count._all ?? 0) }, series: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  }

  @Get("api/word-dash/matches/:matchId/replay")
  async replay(@Param("matchId", ParseUUIDPipe) matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "word_dash" } }, include: { gameConfig: { select: { version: true, settings: true } }, participants: { select: { id: true, userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } }, events: { orderBy: { serverReceivedAt: "asc" }, take: 500, select: { participantId: true, sequence: true, accepted: true, rejectionReason: true, payload: true, clientEventId: true, serverReceivedAt: true, requestHash: true } }, settlement: true, wordDashMatch: true } })
    if (!match || !match.wordDashMatch) throw new BadRequestException("Word Dash match not found")
    const submissions = await this.prisma.wordDashSubmission.findMany({ where: { matchId }, orderBy: { serverReceivedAt: "asc" }, take: 1000 })
    const words = await this.prisma.wordDashFoundWord.findMany({ where: { matchParticipant: { matchId } }, orderBy: { acceptedAt: "asc" } })
    return { match: { id: match.id, status: match.status, mode: match.mode, createdAt: match.createdAt, startedAt: match.startedAt, endedAt: match.endedAt, settledAt: match.settledAt, policyVersion: match.gameConfig.version }, board: { letters: match.wordDashMatch.boardLetters, hash: match.wordDashMatch.boardHash, seed: match.wordDashMatch.seed, rulesVersion: match.wordDashMatch.rulesVersion, dictionaryVersion: match.wordDashMatch.dictionaryVersion, dictionarySha256: match.wordDashMatch.dictionarySha256 }, policy: this.objectValue(this.objectValue(match.gameConfig.settings).wordDashPolicy), players: match.participants, submissions, foundWords: words, events: match.events, settlement: match.settlement }
  }

  @Post("api/word-dash/operations/:matchId/retry-settlement")
  async retrySettlement(@Param("matchId", ParseUUIDPipe) matchId: string, @CurrentUser() admin: UserResponseDto) { const result = await this.wordDash.retrySettlement(matchId); await this.prisma.adminAuditEvent.create({ data: { actorId: admin.id, action: "WORD_DASH_SETTLEMENT_RETRY", entityType: "Match", entityId: matchId, reason: "Manual Word Dash settlement retry", metadata: this.json({ result }) as Prisma.InputJsonValue } }); return { matchId, result } }

  private mergePolicy(input: Record<string, any>) { return { ...DEFAULT_WORD_DASH_POLICY, ...input, dictionaryVersion: this.dictionary.version, scoreTable: { ...DEFAULT_WORD_DASH_POLICY.scoreTable, ...(input.scoreTable ?? {}) }, comboBonuses: { ...DEFAULT_WORD_DASH_POLICY.comboBonuses, ...(input.comboBonuses ?? {}) }, bot: { ...DEFAULT_WORD_DASH_POLICY.bot, ...(input.bot ?? {}) } } }
  private validate(input: Record<string, unknown>) {
    const policy: any = this.mergePolicy(input as Record<string, any>); const integer = (value: unknown, min: number, max: number, label: string) => { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${label} must be an integer from ${min} to ${max}`); return n }; const decimal = (value: unknown, min: number, max: number, label: string) => { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${label} must be between ${min} and ${max}`); return n }
    policy.boardSize = integer(policy.boardSize, 5, 5, "Board size"); policy.durationSeconds = integer(policy.durationSeconds, 30, 180, "Duration"); policy.minimumWordLength = integer(policy.minimumWordLength, 3, 8, "Minimum word length"); policy.comboWindowMs = integer(policy.comboWindowMs, 500, 10000, "Combo window"); policy.maxSubmissionsPerSecond = integer(policy.maxSubmissionsPerSecond, 1, 30, "Maximum submissions per second"); policy.maxAcceptedWordsPerPlayer = integer(policy.maxAcceptedWordsPerPlayer, 1, 500, "Maximum accepted words"); policy.wordScoreCap = integer(policy.wordScoreCap, 100, 100000, "Word score cap"); policy.matchScoreCap = integer(policy.matchScoreCap, 1000, 10000000, "Match score cap")
    policy.comboBonuses.three = decimal(policy.comboBonuses.three, 0, .5, "Three-word combo bonus"); policy.comboBonuses.five = decimal(policy.comboBonuses.five, 0, .5, "Five-word combo bonus"); policy.comboBonuses.eight = decimal(policy.comboBonuses.eight, 0, .5, "Word Rush bonus"); policy.comboBonuses.max = decimal(policy.comboBonuses.max, 0, .5, "Maximum combo bonus"); policy.bot.reactionDelayMs = integer(policy.bot.reactionDelayMs, 250, 10000, "Bot reaction delay"); policy.bot.jitterMs = integer(policy.bot.jitterMs, 0, 10000, "Bot jitter"); policy.bot.maxWords = integer(policy.bot.maxWords, 1, 100, "Bot maximum words"); policy.bot.maxWordLength = integer(policy.bot.maxWordLength, policy.minimumWordLength, 25, "Bot maximum word length"); policy.bot.skill = decimal(policy.bot.skill, 0, 1, "Bot skill");
    if (typeof policy.rulesVersion !== "string" || !/^word-dash\.v[0-9]+$/.test(policy.rulesVersion)) throw new BadRequestException("Rules version must use word-dash.vN format"); if (typeof policy.dictionaryVersion !== "string" || !/^english\.v[0-9]+$/.test(policy.dictionaryVersion)) throw new BadRequestException("Dictionary version must use english.vN format"); if (policy.rankedBotFallback && !policy.rankedEnabled) throw new BadRequestException("Ranked bot fallback requires ranked mode")
    return policy
  }
  private objectValue(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {} }
  private json(value: unknown) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
