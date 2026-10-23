import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { PlayerAuditActorType, Prisma, ProgressionEventSourceType, WalletTransactionSourceType, LeaderboardScoreSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { ApplyLeaderboardScoreTransaction } from "../../leaderboard/transactions/apply-score-transaction"
import { AwardProgressionPointsTransaction } from "../../progression/transactions/award-progression-points-transaction"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { botDisplayName } from "../utilities/bot-display-name"
import { MissionsService } from "../../missions/missions.service"
import { StreaksService } from "../../streaks/streaks.service"
import { WinStreaksService } from "../../win-streaks/win-streaks.service"
import { FraudService } from "../../fraud/fraud.service"
import { deriveParticipantRewardEvidence, isAcceptedScoringEvent, rewardEligibilityForParticipant, type ParticipantRewardEvidence } from "./match-reward-integrity"
import { normalizedMatchXp, rewardPolicy, type RewardPolicy } from "./match-reward-policy"
import { AllyService } from "../../ally/ally.service"

type SettleInput = { matchId: string; userId: string; idempotencyKey: string }

@Injectable()
export class SettleMatchTransaction extends PrismaTransaction<SettleInput, any> {
  constructor(
    prisma: PrismaService,
    private readonly awardProgression: AwardProgressionPointsTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly applyLeaderboardScore: ApplyLeaderboardScoreTransaction,
    private readonly missions: MissionsService,
    private readonly streaks: StreaksService,
    private readonly winStreaks: WinStreaksService,
    private readonly fraud: FraudService,
    private readonly allies: AllyService,
  ) { super(prisma) }

  protected async execute(input: SettleInput, transaction: Prisma.TransactionClient) {
    const match = await transaction.match.findUnique({ where: { id: input.matchId }, include: { gameDefinition: true, gameConfig: true, rankingMatch: true, cooperativeMatch: { include: { teams: true, participants: true } }, participants: { include: { user: { include: { profile: true } } } } } })
    if (!match) throw new NotFoundException("Match not found")
    if (!match.participants.some((item) => item.userId === input.userId)) throw new NotFoundException("Player is not a participant in this match")
    await transaction.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${match.id} FOR UPDATE`
    const lockedMatch = await transaction.match.findUniqueOrThrow({ where: { id: match.id }, include: { gameDefinition: true, gameConfig: true, rankingMatch: true, cooperativeMatch: { include: { teams: true, participants: true } }, participants: { include: { user: { include: { profile: true } } } }, settlement: true } })
    if (lockedMatch.settlement) return lockedMatch.settlement.settlementJson
    if (lockedMatch.status === "CANCELLED" || lockedMatch.status === "SETTLED") throw new ConflictException("The match cannot be settled")

    const humanParticipants = lockedMatch.participants.filter((item) => item.participantType === "PLAYER")
    if (humanParticipants.some((item) => item.result === "PENDING")) return { status: "PENDING", matchId: lockedMatch.id, message: "Waiting for all players to finish" }
    const isPractice = lockedMatch.mode === "PRACTICE"
    // A paid instant skip is a server-verified correct answer. Count it with
    // normal answers so a match made entirely from skips can still settle and
    // its accuracy/progression stats remain truthful.
    const isBoardAuthoritative = lockedMatch.gameDefinition.key === "gem_blitz" || lockedMatch.gameDefinition.key === "tile_rush" || lockedMatch.gameDefinition.key === "word_dash" || lockedMatch.gameDefinition.key === "domino" || lockedMatch.gameDefinition.key === "perfect_timing" || lockedMatch.gameDefinition.key === "bomb_path"
    const acceptedEvents = await transaction.matchEvent.findMany({
      where: { matchId: lockedMatch.id, accepted: true },
      orderBy: { serverReceivedAt: "asc" },
      select: { participantId: true, eventType: true, payload: true, accepted: true, serverReceivedAt: true },
    })
    const acceptedEventsByParticipant = new Map<string, typeof acceptedEvents>()
    for (const event of acceptedEvents) {
      const events = acceptedEventsByParticipant.get(event.participantId) ?? []
      events.push(event)
      acceptedEventsByParticipant.set(event.participantId, events)
    }
    const evidenceByParticipant = new Map<string, ParticipantRewardEvidence>()
    for (const participant of lockedMatch.participants) evidenceByParticipant.set(participant.id, deriveParticipantRewardEvidence(acceptedEventsByParticipant.get(participant.id) ?? [], isBoardAuthoritative))
    const acceptedAnswers = [...evidenceByParticipant.values()].reduce((total, evidence) => total + evidence.acceptedActionCount, 0)
    if (!acceptedAnswers && !isPractice) {
      await transaction.match.update({ where: { id: lockedMatch.id }, data: { status: "REVIEW", endedAt: new Date() } })
      return { status: "REVIEW", matchId: lockedMatch.id, message: "No server-verified answers were recorded; competitive rewards were withheld" }
    }
    const config = lockedMatch.gameConfig
    // Versioned Gem Blitz matches intentionally retain their captured policy
    // after an administrator activates a newer version. They must still settle
    // against that frozen configuration; other games keep the legacy guard.
    if (!config || (!config.active && !isBoardAuthoritative)) throw new BadRequestException("Game reward configuration is inactive")
    if (!isPractice) {
      const progressionKeys = [...new Set([config.mainProgressionKey, config.eloProgressionKey])]
      const validProgressions = await transaction.progressionDefinition.findMany({ where: { key: { in: progressionKeys }, active: true, tiers: { some: { step: 1, pointsThreshold: 0n } } }, select: { key: true } })
      if (validProgressions.length !== progressionKeys.length) {
        await transaction.match.update({ where: { id: lockedMatch.id }, data: { status: "REVIEW", endedAt: new Date() } })
        return { status: "REVIEW", matchId: lockedMatch.id, message: "Reward configuration is incomplete; settlement was held for review" }
      }
    }
    const cooperative = lockedMatch.cooperativeMatch
    const resetWinStreakOnNonWin = await this.winStreaks.shouldResetOnNonWin(transaction)
    const cooperativeRanked = cooperative?.mode === "RANKED"
    const cooperativePolicy = cooperative ? await transaction.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} }) : null
    const requestHash = createHash("sha256").update(JSON.stringify({ matchId: lockedMatch.id, idempotencyKey: input.idempotencyKey.trim() })).digest("hex")
    const idemScope = `match-settlement:${lockedMatch.id}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: idemScope, key: input.idempotencyKey.trim() } }, create: { userId: input.userId, scope: idemScope, key: input.idempotencyKey.trim(), requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The settlement idempotency key is invalid")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson

    const scores = lockedMatch.participants.map((item) => ({ participant: item, score: BigInt(item.finalScore ?? 0) }))
    const hasBotOpponent = lockedMatch.participants.some((item) => item.participantType === "BOT")
    const ratedHumanMatch = !cooperative && !hasBotOpponent && (lockedMatch.mode === "RANKED" || Boolean(lockedMatch.rankingMatch))
    const teamScores = cooperative?.teams.map((team) => ({ teamId: team.id, score: team.score })) ?? []
    const highestTeamScore = teamScores.reduce((max, current) => Math.max(max, current.score), -Infinity)
    const topTeams = teamScores.filter((team) => team.score === highestTeamScore)
    const cooperativeDraw = Boolean(cooperative && topTeams.length > 1)
    const winnerTeamId = !cooperativeDraw ? topTeams[0]?.teamId : undefined
    const highest = scores.reduce((max, current) => current.score > max ? current.score : max, scores[0]?.score ?? 0n)
    const winners = scores.filter((item) => item.score === highest && item.participant.result !== "FORFEIT")
    const forfeited = scores.find((item) => item.participant.result === "FORFEIT")
    const winner = cooperative ? undefined : forfeited ? scores.find((item) => item.participant.id !== forfeited.participant.id) : winners.length === 1 ? winners[0] : undefined
    const draw = cooperative ? cooperativeDraw : !winner && !forfeited && scores.length > 1 && winners.length === scores.length
    // Settlement must retain the exact integrity policy captured when the
    // match was created, even if an administrator activates a newer policy
    // before the match finishes.
    const policyVersion = lockedMatch.integrityPolicyVersion ?? `${lockedMatch.gameDefinition.key}:v${config.version}`
    const results: any[] = []

    for (const item of scores) {
      const player = item.participant.user
      const cooperativeParticipant = cooperative?.participants.find((entry) => entry.matchParticipantId === item.participant.id)
      const isWinner = cooperative ? Boolean(winnerTeamId && cooperativeParticipant?.teamId === winnerTeamId && !draw) : winner?.participant.id === item.participant.id
      const isDraw = draw
      const result = isWinner ? "WIN" : isDraw ? "DRAW" : item.participant.result === "FORFEIT" ? "FORFEIT" : "LOSS"
      const evidence = evidenceByParticipant.get(item.participant.id) ?? { acceptedActionCount: 0, acceptedScoringActionCount: 0, hasUnverifiedActions: false, verifiedPlayMilliseconds: 0, firstAcceptedAt: null, lastAcceptedAt: null }
      const fraudProfile = item.participant.userId
        ? await transaction.fraudProfile.findUnique({ where: { userId: item.participant.userId }, select: { status: true, riskLevel: true, score: true } })
        : null
      const fraudRestricted = fraudProfile?.status === "RESTRICTED" || fraudProfile?.status === "SUSPENDED"
      // WATCH/SUSPICIOUS is an observation state, not enough by itself to
      // withhold every match reward. Reserve automatic holds for the existing
      // high-risk threshold; restricted/suspended accounts remain blocked.
      const fraudHeld = !fraudRestricted && Boolean(fraudProfile && fraudProfile.score >= 60)
      const baseRewardEligibility = item.participant.userId
        ? rewardEligibilityForParticipant({ isPractice, isBotOpponent: hasBotOpponent, isForfeit: result === "FORFEIT", acceptedActionCount: evidence.acceptedActionCount, acceptedScoringActionCount: evidence.acceptedScoringActionCount })
        : "NONE"
      // A forfeiture is never converted back into a reward hold by fraud
      // scoring. This prevents a suspicious quitter from receiving capped XP.
      const rewardEligibility = item.participant.userId
        ? result === "FORFEIT" || fraudRestricted
          ? "NONE"
          : fraudHeld
          ? "HELD"
          : baseRewardEligibility
        : "NONE"
      const rewardHoldReason = isPractice
        ? "PRACTICE_MATCH"
        : result === "FORFEIT"
        ? "FORFEIT"
        : rewardEligibility === "PARTIAL"
        ? "BOT_MATCH_CAP"
        : rewardEligibility === "HELD"
        ? fraudRestricted ? "FRAUD_RESTRICTED" : fraudHeld ? "FRAUD_REVIEW" : "LEGACY_CLIENT_CORRECTNESS"
        : rewardEligibility === "NONE"
        ? fraudRestricted ? "FRAUD_RESTRICTED" : "NO_VERIFIED_ACTIONS"
        : null
      await transaction.matchParticipant.update({
        where: { id: item.participant.id },
        data: {
          result,
          submittedAt: item.participant.submittedAt ?? new Date(),
          acceptedActionCount: evidence.acceptedActionCount,
          acceptedScoringActionCount: evidence.acceptedScoringActionCount,
          verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds,
          firstAcceptedAt: evidence.firstAcceptedAt,
          lastAcceptedAt: evidence.lastAcceptedAt,
          completionState: result === "FORFEIT" ? "FORFEITED" : "COMPLETED",
          terminationReason: result === "FORFEIT" ? (item.participant.terminationReason ?? "VOLUNTARY_FORFEIT") : null,
          rewardEligibility,
          rewardHoldReason,
        },
      })
      // Bots participate in the result calculation but never receive player
      // progression, wallet, leaderboard, or audit rewards. The participant
      // type is authoritative here. Do not infer a bot from a missing user
      // relation: doing that can turn a real player's result into a generated
      // bot name with a misleading zero score in the results screen.
      if (item.participant.participantType === "BOT") {
        // Bots do not receive rewards, but their authoritative result still
        // belongs in the settlement projection so clients can render the
        // opponent's final score and name.
        results.push({
          playerId: item.participant.id,
          username: botDisplayName(lockedMatch.id, item.participant.id),
          displayName: botDisplayName(lockedMatch.id, item.participant.id),
          avatarUrl: null,
          participantType: item.participant.participantType,
          result,
          completionState: result === "FORFEIT" ? "FORFEITED" : "COMPLETED",
          terminationReason: result === "FORFEIT" ? (item.participant.terminationReason ?? "VOLUNTARY_FORFEIT") : null,
          score: item.score.toString(),
          eloDelta: "0",
          rewardEligibility: "NONE",
          rewardHoldReason: "BOT_PARTICIPANT",
          acceptedActionCount: evidence.acceptedActionCount,
          acceptedScoringActionCount: evidence.acceptedScoringActionCount,
          verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds,
          progression: null,
          eloProgression: null,
          wallet: null,
        })
        continue
      }
      // PLAYER rows should always have a user because MatchParticipant.userId
      // is created from the matchmaking ticket. Keep any unexpected data
      // problem visible as a player result rather than silently rewriting it
      // as a bot result.
      if (!player?.id || !item.participant.userId) {
        results.push({
          playerId: item.participant.userId ?? item.participant.id,
          participantType: "PLAYER",
          username: item.participant.userId ?? "Opponent",
          displayName: "Opponent",
          avatarUrl: null,
          result,
          completionState: result === "FORFEIT" ? "FORFEITED" : "COMPLETED",
          terminationReason: result === "FORFEIT" ? (item.participant.terminationReason ?? "VOLUNTARY_FORFEIT") : null,
          score: item.score.toString(),
          eloDelta: "0",
          rewardEligibility: "NONE",
          rewardHoldReason: "PLAYER_IDENTITY_UNAVAILABLE",
          acceptedActionCount: evidence.acceptedActionCount,
          acceptedScoringActionCount: evidence.acceptedScoringActionCount,
          verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds,
          progression: null,
          eloProgression: null,
          wallet: null,
        })
        continue
      }
      // Practice is a fully playable, server-authoritative match, but its
      // settlement is only a result projection. Do not call any of the
      // progression/economy/mission/streak/stat/leaderboard services here.
      // Keeping this guard before score calculations also makes the invariant
      // obvious: no future reward path can accidentally leak into practice.
      if (isPractice) {
        results.push({
          playerId: player.id,
          username: player.username,
          displayName: player.profile?.displayName ?? player.username,
          avatarUrl: player.profile?.avatarUrl ?? null,
          participantType: item.participant.participantType,
          result,
          completionState: result === "FORFEIT" ? "FORFEITED" : "COMPLETED",
          terminationReason: result === "FORFEIT" ? (item.participant.terminationReason ?? "VOLUNTARY_FORFEIT") : null,
          score: item.score.toString(),
          eloDelta: "0",
          rewardEligibility: "NONE",
          rewardHoldReason,
          acceptedActionCount: evidence.acceptedActionCount,
          acceptedScoringActionCount: evidence.acceptedScoringActionCount,
          verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds,
          progression: null,
          eloProgression: null,
          wallet: null,
          cognitiveStats: null,
          practice: true,
        })
        continue
      }
      const scoreDiff = winner && !isDraw ? item.score - (winner.participant.id === item.participant.id ? scores.find((candidate) => candidate.participant.id !== item.participant.id)?.score ?? 0n : winner.score) : 0n
      const forfeitPenalty = BigInt(Math.max(1, Math.floor(config.maxEloDelta / 2)))
      const eloDelta = cooperativeRanked && cooperativePolicy?.cooperativeRewardsEnabled
        ? this.cooperativeEloDelta(cooperative, cooperativeParticipant, result, cooperativePolicy)
        : ratedHumanMatch && !fraudRestricted && !fraudHeld && (rewardEligibility === "FULL" || result === "FORFEIT")
        ? forfeited
          ? result === "FORFEIT" ? -forfeitPenalty : isWinner ? forfeitPenalty : 0n
          : this.clamp(scoreDiff, -BigInt(config.maxEloDelta), BigInt(config.maxEloDelta))
        : 0n
      const policy = rewardPolicy(config, lockedMatch.gameDefinition.key)
      const opponent = humanParticipants.find((candidate) => candidate.id !== item.participant.id)?.userId ?? null
      const repeatedOpponent = item.participant.userId && opponent
        ? await transaction.matchParticipant.count({ where: { userId: item.participant.userId, matchId: { not: lockedMatch.id }, match: { mode: { in: ["CASUAL", "BOT"] }, createdAt: { gte: new Date(Date.now() - 86400000) }, participants: { some: { userId: opponent } } } } })
        : 0
      const computedXp = rewardEligibility === "FULL" || rewardEligibility === "PARTIAL" || rewardEligibility === "HELD"
        ? normalizedMatchXp(policy, item.score, result, hasBotOpponent, repeatedOpponent)
        : 0n
      const rewardBase = isDraw ? config.drawReward : isWinner ? config.winnerBaseReward : config.loserBaseReward
      const rewardBonus = lockedMatch.mode === "SINGLE_PLAYER" || lockedMatch.mode === "BOT"
        ? this.min(config.scoreRewardCap, item.score / BigInt(config.scoreRewardDivisor))
        : isDraw ? 0n : this.min(isWinner ? config.winnerRewardBonusMax : config.loserRewardBonusMax, this.ratio(this.abs(scoreDiff), config.multiplayerRewardReference, isWinner ? config.winnerRewardBonusMax : config.loserRewardBonusMax))
      // Ranked entry matches distribute their explicitly configured pot. They
      // do not also mint the normal casual match reward.
      const computedCoinReward = rewardEligibility !== "FULL" || fraudHeld || fraudRestricted || lockedMatch.rankingMatch || cooperativeRanked
        ? 0n
        : this.diminish(this.multiply(rewardBase + rewardBonus, config.rankingEnabled ? config.rankingCoinMultiplier.toString() : "1"), policy.sameOpponentDiminishingFactor, repeatedOpponent)
      let xp = rewardEligibility === "HELD" ? this.min(50n, computedXp) : computedXp
      let coinReward = computedCoinReward
      let xpCappedByDailyLimit = false
      let gldCappedByDailyLimit = false
      if (item.participant.userId && (xp > 0n || coinReward > 0n)) {
        const capped = await this.applyDailyCaps(transaction, item.participant.userId, lockedMatch.gameDefinitionId, policy, xp, coinReward)
        xpCappedByDailyLimit = capped.xp < xp
        gldCappedByDailyLimit = capped.gld < coinReward
        xp = capped.xp
        coinReward = capped.gld
      }
      if (item.participant.userId && rewardEligibility === "HELD") {
        await transaction.matchRewardHold.upsert({
          where: { matchParticipantId: item.participant.id },
          create: {
            matchId: lockedMatch.id,
            matchParticipantId: item.participant.id,
            userId: item.participant.userId,
            reason: rewardHoldReason ?? "REWARD_REVIEW",
            heldXp: computedXp > xp ? computedXp - xp : 0n,
            heldGld: computedCoinReward > coinReward ? computedCoinReward - coinReward : 0n,
            heldElo: 0n,
          },
          update: {},
        })
      }
      if (item.participant.userId) {
        const fraudObservations: Array<{ type: string; metadata: Record<string, unknown> }> = []
        if (result === "FORFEIT") fraudObservations.push({ type: "REPEATED_MATCH_FORFEITS", metadata: { gameKey: lockedMatch.gameDefinition.key, terminationReason: item.participant.terminationReason ?? "VOLUNTARY_FORFEIT" } })
        if (lockedMatch.rankingMatch && result === "FORFEIT") fraudObservations.push({ type: "RANKED_QUIT_AVOIDANCE", metadata: { gameKey: lockedMatch.gameDefinition.key } })
        if (evidence.acceptedActionCount <= 1 || evidence.verifiedPlayMilliseconds < 1000) fraudObservations.push({ type: "SHORT_MATCH_REWARD_FARMING", metadata: { gameKey: lockedMatch.gameDefinition.key, acceptedActionCount: evidence.acceptedActionCount, verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds } })
        if (hasBotOpponent) fraudObservations.push({ type: "BOT_REWARD_FARMING", metadata: { gameKey: lockedMatch.gameDefinition.key } })
        if (repeatedOpponent >= 3) fraudObservations.push({ type: "SAME_OPPONENT_FARMING", metadata: { gameKey: lockedMatch.gameDefinition.key, repeatedOpponent } })
        if (xpCappedByDailyLimit) fraudObservations.push({ type: "MATCH_XP_VELOCITY", metadata: { gameKey: lockedMatch.gameDefinition.key, requestedXp: computedXp.toString(), awardedXp: xp.toString() } })
        if (gldCappedByDailyLimit) fraudObservations.push({ type: "MATCH_GLD_VELOCITY", metadata: { gameKey: lockedMatch.gameDefinition.key, requestedGld: computedCoinReward.toString(), awardedGld: coinReward.toString() } })
        for (const observation of fraudObservations) {
          await this.fraud.observe(item.participant.userId, { type: observation.type, sourceType: "MATCH_SETTLEMENT", sourceId: `${lockedMatch.id}:${item.participant.userId}:${observation.type}`, metadata: { matchId: lockedMatch.id, ...observation.metadata } }).catch(() => undefined)
        }
      }

      const progression = xp > 0n ? await this.awardProgression.runWithinTransaction({ userId: player.id, progressionKey: config.mainProgressionKey, amount: xp, sourceId: `${lockedMatch.id}:xp:${player.id}`, sourceType: ProgressionEventSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion, rewardEligibility } }, transaction) : null
      const eloProgression = eloDelta !== 0n ? await this.awardProgression.runWithinTransaction({ userId: player.id, progressionKey: config.eloProgressionKey, amount: eloDelta, sourceId: `${lockedMatch.id}:elo:${player.id}`, sourceType: ProgressionEventSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion, rewardEligibility } }, transaction) : null
      const wallet = coinReward > 0n ? await this.creditWallet.runWithinTransaction({ userId: player.id, currencyCode: config.rewardCurrencyCode, amount: coinReward, sourceId: `${lockedMatch.id}:currency:${player.id}`, sourceType: WalletTransactionSourceType.MATCH, metadata: { matchId: lockedMatch.id, result, policyVersion, rewardEligibility } }, transaction) : null
      const answerEvents = (acceptedEventsByParticipant.get(item.participant.id) ?? []).filter((event) => isAcceptedScoringEvent(event, isBoardAuthoritative))
      const answerSummary = answerEvents.reduce((summary, event) => {
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {}
        const timeTakenMs = typeof payload.timeTakenMs === "number" && Number.isSafeInteger(payload.timeTakenMs) && payload.timeTakenMs >= 0 ? payload.timeTakenMs : 0
        return { totalQuestions: summary.totalQuestions + 1, totalCorrect: summary.totalCorrect + (isBoardAuthoritative ? 1 : payload.correct === true ? 1 : 0), totalTimeMs: summary.totalTimeMs + BigInt(timeTakenMs) }
      }, { totalQuestions: 0, totalCorrect: 0, totalTimeMs: 0n })
      const engagementPayload = { matchId: lockedMatch.id, gameKey: lockedMatch.gameDefinition.key, mode: lockedMatch.mode, ranking: Boolean(lockedMatch.rankingMatch) }
      const grantGameplayCredit = rewardEligibility === "FULL"
      if (grantGameplayCredit) {
        await this.missions.recordWithinTransaction({ userId: player.id, eventType: "MATCH_PLAYED", sourceId: `${lockedMatch.id}:${player.id}:played`, payload: engagementPayload }, transaction)
        await this.streaks.recordWithinTransaction({ userId: player.id, sourceId: lockedMatch.id, activityType: "MATCH_COMPLETED" }, transaction)
        if (result === "WIN") await this.missions.recordWithinTransaction({ userId: player.id, eventType: "MATCH_WON", sourceId: `${lockedMatch.id}:${player.id}:won`, payload: engagementPayload }, transaction)
        if (!isBoardAuthoritative && answerSummary.totalCorrect > 0) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "CORRECT_ANSWER", sourceId: `${lockedMatch.id}:${player.id}:correct`, amount: answerSummary.totalCorrect, payload: engagementPayload }, transaction)
        if (!isBoardAuthoritative && answerSummary.totalQuestions > 0 && answerSummary.totalCorrect === answerSummary.totalQuestions) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "PERFECT_MATCH", sourceId: `${lockedMatch.id}:${player.id}:perfect`, payload: engagementPayload }, transaction)
      }
      if (grantGameplayCredit && lockedMatch.gameDefinition.key === "gem_blitz") {
        const gemEvents = await transaction.matchEvent.findMany({ where: { matchId: lockedMatch.id, participantId: item.participant.id, eventType: "SCORE_UPDATE", accepted: true }, select: { payload: true } })
        const specialEvents = gemEvents.filter((event) => { const payload = event.payload as any; return typeof payload?.specialCreated === "string" && payload.specialCreated.length > 0 })
        const comboEvents = gemEvents.filter((event) => { const payload = event.payload as any; return Number(payload?.cascades ?? 0) > 1 || Number(payload?.speedCombo ?? 0) > 1 })
        if (specialEvents.length) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "GEM_BLITZ_SPECIAL", sourceId: `${lockedMatch.id}:${player.id}:specials`, amount: specialEvents.length, payload: { ...engagementPayload, count: specialEvents.length } }, transaction)
        if (comboEvents.length) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "GEM_BLITZ_COMBO", sourceId: `${lockedMatch.id}:${player.id}:combos`, amount: comboEvents.length, payload: { ...engagementPayload, count: comboEvents.length } }, transaction)
      }
      if (grantGameplayCredit && lockedMatch.gameDefinition.key === "tile_rush") {
        const tileEvents = await transaction.matchEvent.findMany({ where: { matchId: lockedMatch.id, participantId: item.participant.id, eventType: "SCORE_UPDATE", accepted: true }, select: { payload: true } })
        const payloads = tileEvents.map((event) => event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, any> : {})
        const tilesCleared = payloads.reduce((total, payload) => total + (Array.isArray(payload.clearedCells) ? payload.clearedCells.length : 0), 0)
        const longChains = payloads.filter((payload) => Number(payload.chainLength ?? 0) >= 8).length
        const colorCrushes = payloads.filter((payload) => payload.special === "colorCrush").length
        const maxCombo = payloads.reduce((max, payload) => Math.max(max, Number(payload.combo ?? 0)), 0)
        if (tilesCleared > 0) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_TILES_CLEARED", sourceId: `${lockedMatch.id}:${player.id}:tiles`, amount: tilesCleared, payload: { ...engagementPayload, tilesCleared } }, transaction)
        if (longChains > 0) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_LONG_CHAIN", sourceId: `${lockedMatch.id}:${player.id}:long-chains`, amount: longChains, payload: { ...engagementPayload, longChains } }, transaction)
        if (colorCrushes > 0) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_COLOR_CRUSH", sourceId: `${lockedMatch.id}:${player.id}:color-crushes`, amount: colorCrushes, payload: { ...engagementPayload, colorCrushes } }, transaction)
        if (maxCombo > 0) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_COMBO", sourceId: `${lockedMatch.id}:${player.id}:combo`, amount: maxCombo, payload: { ...engagementPayload, maxCombo } }, transaction)
        if (result === "WIN") {
          await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_MATCH_WON", sourceId: `${lockedMatch.id}:${player.id}:won`, payload: engagementPayload }, transaction)
          const opponentScore = scores.find((candidate) => candidate.participant.id !== item.participant.id)?.score
          if (opponentScore != null && item.score - opponentScore < 100n) await this.missions.recordWithinTransaction({ userId: player.id, eventType: "TILE_RUSH_CLOSE_WIN", sourceId: `${lockedMatch.id}:${player.id}:close-win`, payload: engagementPayload }, transaction)
        }
      }
      if (grantGameplayCredit && (lockedMatch.rankingMatch || cooperativeRanked)) {
        await this.missions.recordWithinTransaction({ userId: player.id, eventType: "RANKED_MATCH_PLAYED", sourceId: `${lockedMatch.id}:${player.id}:ranked-played`, payload: engagementPayload }, transaction)
        if (result === "WIN") await this.missions.recordWithinTransaction({ userId: player.id, eventType: "RANKED_MATCH_WON", sourceId: `${lockedMatch.id}:${player.id}:ranked-won`, payload: engagementPayload }, transaction)
      }
      // PlayerGameStats is the source for the per-game all-time leaderboard.
      // Eligible CASUAL human matches are deliberately included here; only
      // PRACTICE, bot/reduced-evidence, forfeited, or held matches are
      // excluded by rewardEligibility. This is separate from public Elo,
      // which remains ranked-only below.
      const gameLeaderboardEligible = grantGameplayCredit && !isPractice
      const winStreak = gameLeaderboardEligible
        ? await this.updateStats(transaction, lockedMatch, item.participant, result, item.score, answerSummary, resetWinStreakOnNonWin)
        : { before: 0, after: 0 }
      const cognitiveEligible = !isPractice && result !== "FORFEIT" && rewardEligibility !== "NONE" && evidence.acceptedActionCount > 0
      const cognitiveStats = cognitiveEligible ? await this.updateCognitiveStats(transaction, lockedMatch, item.participant, result, item.score, answerSummary) : null
      if (eloDelta !== 0n && (ratedHumanMatch || cooperativeRanked) && rewardEligibility === "FULL") {
        const leaderboardKeys = this.getLeaderboardKeys(config)
        for (const leaderboardKey of [leaderboardKeys.playerWeekly, leaderboardKeys.playerMonthly]) await this.applyLeaderboardScore.runWithinTransaction({ leaderboardKey, playerId: player.id, delta: eloDelta, allowFloorAtZero: true, sourceId: `${lockedMatch.id}:leaderboard:${leaderboardKey}:${player.id}`, sourceType: LeaderboardScoreSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
        const country = player.profile?.countryCode?.trim().toUpperCase()
        const opponent = humanParticipants.find((candidate) => candidate.id !== item.participant.id)?.user?.profile?.countryCode?.trim().toUpperCase()
        if (country && country !== opponent) for (const leaderboardKey of [leaderboardKeys.countryWeekly, leaderboardKeys.countryMonthly]) await this.applyLeaderboardScore.runWithinTransaction({ leaderboardKey, memberKey: country, delta: eloDelta, allowFloorAtZero: true, sourceId: `${lockedMatch.id}:leaderboard:${leaderboardKey}:${country}`, sourceType: LeaderboardScoreSourceType.MATCH, metadata: { matchId: lockedMatch.id, policyVersion } }, transaction)
      }
      await writePlayerAudit(transaction, { userId: player.id, actorType: PlayerAuditActorType.SYSTEM, action: "MATCH_SETTLED", entityType: "Match", entityId: lockedMatch.id, summary: `Match settled with result ${result}`, changes: { result: { old: "PENDING", new: result }, scoreEarned: { old: 0n, new: item.score }, eloDelta: { old: 0n, new: eloDelta }, xpAwarded: { old: 0n, new: xp }, currencyReward: { old: 0n, new: coinReward } }, metadata: { gameKey: lockedMatch.gameDefinition.key, policyVersion, rewardEligibility, rewardHoldReason, acceptedActionCount: evidence.acceptedActionCount, acceptedScoringActionCount: evidence.acceptedScoringActionCount, verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds } })
      results.push({ playerId: player.id, participantType: item.participant.participantType, username: player.username, displayName: player.profile?.displayName ?? player.username, avatarUrl: player.profile?.avatarUrl ?? null, result, completionState: result === "FORFEIT" ? "FORFEITED" : "COMPLETED", terminationReason: result === "FORFEIT" ? (item.participant.terminationReason ?? "VOLUNTARY_FORFEIT") : null, score: item.score.toString(), eloDelta: eloDelta.toString(), rewardEligibility, rewardHoldReason, acceptedActionCount: evidence.acceptedActionCount, acceptedScoringActionCount: evidence.acceptedScoringActionCount, verifiedPlayMilliseconds: evidence.verifiedPlayMilliseconds, progression, eloProgression, wallet, cognitiveStats, winStreakBefore: winStreak.before, winStreakAfter: winStreak.after })
    }

    const endedOpponentStreaks = results
      .filter((entry) => entry.result === "LOSS" && Number(entry.winStreakBefore ?? 0) > 0)
      .map((entry) => ({ username: entry.username ?? "Opponent", streak: Number(entry.winStreakBefore) }))
    for (const entry of results) {
      if (entry.result === "WIN" && endedOpponentStreaks.length) entry.endedOpponentStreaks = endedOpponentStreaks
    }

    const holdRankedPayout = async (participant: any, amount: bigint, reason: string) => {
      if (!participant.userId || amount <= 0n) return
      await transaction.matchRewardHold.upsert({
        where: { matchParticipantId: participant.id },
        create: { matchId: lockedMatch.id, matchParticipantId: participant.id, userId: participant.userId, reason, heldXp: 0n, heldGld: amount, heldElo: 0n },
        update: { heldGld: { increment: amount }, reason },
      })
      await transaction.matchParticipant.update({ where: { id: participant.id }, data: { rewardEligibility: "HELD", rewardHoldReason: reason } })
      const resultEntry = results.find((entry) => entry.playerId === participant.userId)
      if (resultEntry) { resultEntry.rewardEligibility = "HELD"; resultEntry.rewardHoldReason = reason }
    }

    if (!isPractice && lockedMatch.rankingMatch) {
      if (winner?.participant.userId) {
        const winnerResult = results.find((entry) => entry.playerId === winner.participant.userId)
        if (winnerResult?.rewardEligibility === "FULL") await this.creditWallet.runWithinTransaction({
          userId: winner.participant.userId,
          currencyCode: "GLD",
          amount: lockedMatch.rankingMatch.payoutAmountGld,
          sourceId: `${lockedMatch.id}:ranking-payout`,
          sourceType: WalletTransactionSourceType.RANKING_MATCH_PAYOUT,
          metadata: { matchId: lockedMatch.id, stakeAmountGld: lockedMatch.rankingMatch.stakeAmountGld.toString(), entryFeeGld: lockedMatch.rankingMatch.entryFeeGld.toString(), entryFeeGldMicros: lockedMatch.rankingMatch.entryFeeGldMicros.toString(), payoutAmountGld: lockedMatch.rankingMatch.payoutAmountGld.toString() },
        }, transaction)
        else await holdRankedPayout(winner.participant, lockedMatch.rankingMatch.payoutAmountGld, "RANKED_PAYOUT_REVIEW")
        await transaction.rankingMatch.update({ where: { id: lockedMatch.rankingMatch.id }, data: { status: "SETTLED", winnerUserId: winner.participant.userId, settledAt: new Date() } })
      } else {
        // A draw returns each stake after retaining the configured entry fee.
        const feeMicros = lockedMatch.rankingMatch.entryFeeGldMicros || lockedMatch.rankingMatch.entryFeeGld * 1_000_000n
        const refundFeeWhole = (feeMicros + 1_000_000n - 1n) / 1_000_000n
        const refund = lockedMatch.rankingMatch.stakeAmountGld - refundFeeWhole
        for (const item of humanParticipants) if (item.userId && refund > 0n) await this.creditWallet.runWithinTransaction({ userId: item.userId, currencyCode: "GLD", amount: refund, sourceId: `${lockedMatch.id}:ranking-draw-refund:${item.userId}`, sourceType: WalletTransactionSourceType.RANKING_MATCH_REFUND, metadata: { matchId: lockedMatch.id, reason: "ranking_draw" } }, transaction)
        await transaction.rankingMatch.update({ where: { id: lockedMatch.rankingMatch.id }, data: { status: "REFUNDED", settledAt: new Date() } })
      }
    }

    if (!isPractice && cooperativeRanked && cooperativePolicy?.cooperativeRewardsEnabled) {
      const winningPlayers = humanParticipants.filter((item) => cooperative?.participants.find((entry) => entry.matchParticipantId === item.id)?.teamId === winnerTeamId && item.result !== "FORFEIT")
      if (winnerTeamId && winningPlayers.length) {
        const perWinner = new Prisma.Decimal(cooperative.payoutAmountGld).div(winningPlayers.length)
        for (const item of winningPlayers) {
          const itemResult = results.find((entry) => entry.playerId === item.userId)
          const payoutAmount = BigInt(perWinner.floor().toFixed(0))
          if (itemResult?.rewardEligibility !== "FULL") {
            await holdRankedPayout(item, payoutAmount, "COOPERATIVE_RANKED_PAYOUT_REVIEW")
            continue
          }
          const sourceId = `${lockedMatch.id}:cooperative-payout:${item.userId}`
          await this.creditWallet.runWithinTransaction({ userId: item.userId!, currencyCode: "GLD", amount: payoutAmount, amountDecimal: perWinner.toString(), sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_PAYOUT, metadata: { matchId: lockedMatch.id, cooperative: true, mode: "RANKED", payoutAmountGld: perWinner.toString() } }, transaction)
          const ledger = await transaction.walletTransaction.findFirst({ where: { sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_PAYOUT }, orderBy: { createdAt: "desc" }, select: { id: true } })
          await transaction.cooperativeLedgerOperation.upsert({ where: { idempotencyKey: sourceId }, create: { cooperativeMatchId: cooperative.id, userId: item.userId!, operationType: "PAYOUT", amount: perWinner, walletTransactionId: ledger?.id, idempotencyKey: sourceId, status: "CAPTURED", metadata: { teamId: winnerTeamId } as Prisma.InputJsonValue }, update: { status: "CAPTURED", walletTransactionId: ledger?.id } })
        }
      } else {
        for (const item of humanParticipants) if (item.userId && new Prisma.Decimal(cooperative.entryFeeGld).gt(0)) {
          const sourceId = `${lockedMatch.id}:cooperative-refund:${item.userId}`
          await this.creditWallet.runWithinTransaction({ userId: item.userId, currencyCode: "GLD", amount: BigInt(new Prisma.Decimal(cooperative.entryFeeGld).floor().toFixed(0)), amountDecimal: cooperative.entryFeeGld.toString(), sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_REFUND, metadata: { matchId: lockedMatch.id, cooperative: true, reason: "draw" } }, transaction)
          const ledger = await transaction.walletTransaction.findFirst({ where: { sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_REFUND }, orderBy: { createdAt: "desc" }, select: { id: true } })
          await transaction.cooperativeLedgerOperation.upsert({ where: { idempotencyKey: sourceId }, create: { cooperativeMatchId: cooperative.id, userId: item.userId, operationType: "REFUND", amount: cooperative.entryFeeGld, walletTransactionId: ledger?.id, idempotencyKey: sourceId, status: "CAPTURED", metadata: { reason: "draw" } as Prisma.InputJsonValue }, update: { status: "CAPTURED", walletTransactionId: ledger?.id } })
        }
      }
    }

    if (!isPractice && cooperative) {
      await Promise.all(cooperative.teams.map((team) => transaction.cooperativeTeam.update({ where: { id: team.id }, data: { result: draw ? "DRAW" : team.id === winnerTeamId ? "WIN" : "LOSS" } })))
      await transaction.cooperativeMatch.update({ where: { id: cooperative.id }, data: { status: "SETTLED", endedAt: lockedMatch.endedAt ?? new Date(), settledAt: new Date() } })
      const metadata = lockedMatch.metadata && typeof lockedMatch.metadata === "object" && !Array.isArray(lockedMatch.metadata) ? lockedMatch.metadata as Record<string, unknown> : {}
      const partyIds = Array.isArray(metadata.partyIds) ? metadata.partyIds.filter((id): id is string => typeof id === "string" && id.length > 0) : []
      if (partyIds.length) {
        // A matched cooperative queue entry is no longer searchable after the
        // match settles. Leaving it as MATCHED makes PartyService return the
        // old match as soon as the player returns to the lobby, which keeps
        // the mobile UI in an endless "opening game" state.
        await transaction.cooperativeQueueEntry.updateMany({
          where: { partyId: { in: partyIds }, matchId: lockedMatch.id, status: "MATCHED" },
          data: { status: "SETTLED" },
        })
        await transaction.party.updateMany({
          where: { id: { in: partyIds }, status: { in: ["MATCH_FOUND", "COMMITTED", "IN_MATCH", "RESULTS"] } },
          data: { status: "READY", matchedAt: null, queuedAt: null, expiresAt: new Date(Date.now() + Number(cooperativePolicy?.partyIdleMinutes ?? 30) * 60_000) },
        })
      }
      await this.allies.recordSettledCooperativeMatchWithinTransaction(transaction, {
        matchId: lockedMatch.id,
        mode: cooperative.mode,
        botFilled: cooperative.botFilled,
        participants: cooperative.participants.map((participant) => {
          const result = results.find((entry) => entry.playerId === participant.userId)
          return { userId: participant.userId, teamId: participant.teamId, result: result?.result ?? "LOSS", rewardEligibility: result?.rewardEligibility ?? "NONE" }
        }),
        teams: cooperative.teams.map((team) => ({ id: team.id, result: draw ? "DRAW" : team.id === winnerTeamId ? "WIN" : "LOSS" })),
      })
    }
    const settlementJson = { status: "SETTLED", matchId: lockedMatch.id, mode: lockedMatch.mode, practice: isPractice, policyVersion, winnerPlayerId: winner?.participant.userId ?? null, draw, cooperative: !isPractice && cooperative ? { mode: cooperative.mode, winnerTeamId: winnerTeamId ?? null, entryFeeGld: cooperative.entryFeeGld, payoutAmountGld: cooperative.payoutAmountGld, teams: cooperative.teams.map((team) => ({ teamId: team.id, teamNumber: team.teamNumber, score: team.score, result: draw ? "DRAW" : team.id === winnerTeamId ? "WIN" : "LOSS" })) } : null, results }
    const settlement = await transaction.matchSettlement.create({ data: { matchId: lockedMatch.id, policyVersion, winnerParticipantId: winner?.participant.id, settlementJson: settlementJson as Prisma.InputJsonValue, idempotencyKeyId: idem.id } })
    await transaction.outboxEvent.create({ data: { eventType: "MATCH_SETTLED", aggregateType: "Match", aggregateId: lockedMatch.id, payload: settlementJson as Prisma.InputJsonValue } })
    await transaction.match.update({ where: { id: lockedMatch.id }, data: { status: "SETTLED", endedAt: lockedMatch.endedAt ?? new Date(), settledAt: new Date() } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: settlementJson as Prisma.InputJsonValue, completedAt: new Date() } })
    return settlementJson
  }

  private cooperativeEloDelta(cooperative: any, participant: any, result: string, policy: any) {
    if (!participant || result === "DRAW") return 0n
    const ownTeam = cooperative.teams.find((team: any) => team.id === participant.teamId)
    const opponentTeams = cooperative.teams.filter((team: any) => team.id !== participant.teamId)
    const own = cooperative.participants.filter((item: any) => item.teamId === ownTeam?.id && item.userId).map((item: any) => item.eloSnapshot)
    const opponent = cooperative.participants.filter((item: any) => opponentTeams.some((team: any) => team.id === item.teamId) && item.userId).map((item: any) => item.eloSnapshot)
    const ownAverage = own.length ? own.reduce((sum: number, value: number) => sum + value, 0) / own.length : 0
    const opponentAverage = opponent.length ? opponent.reduce((sum: number, value: number) => sum + value, 0) / opponent.length : ownAverage
    const adjustment = Math.round(((opponentAverage - ownAverage) / 100) * (policy.rankedTeamRatingWeightPercent / 100))
    const magnitude = Math.max(1, Math.min(policy.rankedEloMaxDelta, policy.rankedEloBaseDelta + adjustment))
    return BigInt(result === "WIN" ? magnitude : -magnitude)
  }

  private async updateStats(transaction: Prisma.TransactionClient, match: any, participant: any, result: string, score: bigint, answers: { totalCorrect: number; totalQuestions: number; totalTimeMs: bigint }, resetOnNonWin: boolean) {
    if (!participant.userId) return { before: 0, after: 0 }
    const stats = await transaction.playerStats.findUnique({ where: { userId: participant.userId } })
    let before = stats?.currentWinStreak ?? 0
    let after = before
    if (stats) {
      await transaction.$queryRaw`SELECT "id" FROM "PlayerStats" WHERE "id" = ${stats.id} FOR UPDATE`
      const streak = result === "WIN" ? stats.currentWinStreak + 1 : resetOnNonWin ? 0 : stats.currentWinStreak
      before = stats.currentWinStreak
      after = streak
      await transaction.playerStats.update({ where: { id: stats.id }, data: { gamesPlayed: { increment: 1 }, wins: result === "WIN" ? { increment: 1 } : undefined, losses: result === "LOSS" ? { increment: 1 } : undefined, draws: result === "DRAW" ? { increment: 1 } : undefined, currentWinStreak: streak, highestWinStreak: streak > stats.highestWinStreak ? streak : undefined, totalScore: { increment: score } } })
    }
    const gameStats = await transaction.playerGameStats.upsert({ where: { userId_gameDefinitionId: { userId: participant.userId, gameDefinitionId: match.gameDefinitionId } }, create: { userId: participant.userId, gameDefinitionId: match.gameDefinitionId, gamesPlayed: 1, wins: result === "WIN" ? 1 : 0, losses: result === "LOSS" ? 1 : 0, draws: result === "DRAW" ? 1 : 0, forfeits: result === "FORFEIT" ? 1 : 0, totalCorrect: answers.totalCorrect, totalQuestions: answers.totalQuestions, totalTimeMs: answers.totalTimeMs, totalScore: score, bestScore: score, lastPlayedAt: new Date() }, update: { gamesPlayed: { increment: 1 }, wins: result === "WIN" ? { increment: 1 } : undefined, losses: result === "LOSS" ? { increment: 1 } : undefined, draws: result === "DRAW" ? { increment: 1 } : undefined, forfeits: result === "FORFEIT" ? { increment: 1 } : undefined, totalCorrect: { increment: answers.totalCorrect }, totalQuestions: { increment: answers.totalQuestions }, totalTimeMs: { increment: answers.totalTimeMs }, totalScore: { increment: score }, lastPlayedAt: new Date() } })
    if (gameStats.bestScore < score) await transaction.playerGameStats.update({ where: { id: gameStats.id }, data: { bestScore: score } })
    return { before, after }
  }

  /** Update server-owned cognitive skills from accepted answer evidence. */
  private async updateCognitiveStats(
    transaction: Prisma.TransactionClient,
    match: any,
    participant: any,
    result: string,
    score: bigint,
    answers: { totalCorrect: number; totalQuestions: number; totalTimeMs: bigint },
  ) {
    if (!participant.userId) return null

    const profile = await transaction.playerCognitiveStats.upsert({
      where: { userId: participant.userId },
      create: { userId: participant.userId },
      update: {},
    })
    await transaction.$queryRaw`SELECT "id"::text FROM "PlayerCognitiveStats" WHERE "id" = ${profile.id} FOR UPDATE`

    const questionCount = answers.totalQuestions
    const accuracy = questionCount > 0 ? (answers.totalCorrect / questionCount) * 100 : 50
    const averageTimeMs = questionCount > 0 ? Number(answers.totalTimeMs) / questionCount : 0
    const maxTimeMs = Math.max(1000, Number(match.gameConfig?.maxAnswerTimeSeconds ?? 30) * 1000)
    const speed = questionCount > 0 ? this.clampNumber(100 - (averageTimeMs / maxTimeMs) * 100, 0, 100) : 50
    const resultSignal = result === "WIN" ? 100 : result === "DRAW" ? 60 : result === "FORFEIT" ? 20 : 35
    const configuredPoints = Object.values((match.gameConfig?.correctAnswerPoints ?? {}) as Record<string, unknown>)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
    const maxPoints = Math.max(1, ...(configuredPoints.length ? configuredPoints : [100]))
    const scoreSignal = questionCount > 0
      ? this.clampNumber((Number(score) / (questionCount * maxPoints)) * 100, 0, 100)
      : resultSignal
    const performance = this.clampNumber(accuracy * 0.5 + speed * 0.25 + resultSignal * 0.1 + scoreSignal * 0.15, 0, 100)
    const key = String(match.gameDefinition?.key ?? "").toLowerCase()
    // A match is evidence, not a complete skill assessment. Only the skills
    // exercised by this game receive a meaningful update. The bounded rate
    // prevents a single lucky result from moving a player from the 50 baseline
    // to the 90s, while repeated fast, accurate matches can still reach 90+.
    const targets: Record<string, number> = {}
    const addSkill = (name: string, value: number) => { targets[name] = this.clampNumber(value, 0, 100) }
    addSkill("accuracy", accuracy)
    if (key === "math") {
      addSkill("calculation", accuracy * 0.7 + speed * 0.3)
      addSkill("speed", speed)
    } else if (["flick_master", "stacking"].includes(key)) {
      addSkill("speed", speed)
      addSkill("judgement", performance * 0.65 + accuracy * 0.35)
    } else if (["high_low", "trivia", "follow_the_lead"].includes(key)) {
      addSkill("judgement", performance * 0.65 + accuracy * 0.35)
    } else if (["bird_watching", "similarities"].includes(key)) {
      addSkill("observation", performance * 0.7 + accuracy * 0.3)
    } else if (key === "memorize_cards") {
      addSkill("memory", performance * 0.75 + accuracy * 0.25)
    } else {
      addSkill("judgement", performance)
    }

    const evidence = this.clampNumber(questionCount / 15, 0, 1)
    const confidence = this.clampNumber(0.35 + evidence * 0.65, 0.35, 1)
    const learningRate = (profile.matchesEvaluated === 0 ? 0.08 : 0.06) * confidence
    const before = {
      calculation: profile.calculation,
      speed: profile.speed,
      accuracy: profile.accuracy,
      judgement: profile.judgement,
      observation: profile.observation,
      memory: profile.memory,
    }
    const next = { ...before }
    for (const [skill, target] of Object.entries(targets)) {
      next[skill as keyof typeof next] = Math.round(this.clampNumber(before[skill as keyof typeof before] + (target - before[skill as keyof typeof before]) * learningRate, 0, 100))
    }
    await transaction.playerCognitiveStats.update({
      where: { id: profile.id },
      data: {
        calculation: next.calculation,
        speed: next.speed,
        accuracy: next.accuracy,
        judgement: next.judgement,
        observation: next.observation,
        memory: next.memory,
        matchesEvaluated: { increment: 1 },
      },
    })
    return {
      before,
      after: next,
      delta: Object.fromEntries(Object.keys(next).map((skill) => [skill, next[skill as keyof typeof next] - before[skill as keyof typeof before]])),
      matchesEvaluated: profile.matchesEvaluated + 1,
    }
  }

  private clampNumber(value: number, minimum: number, maximum: number) {
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum
  }

  private async applyDailyCaps(
    transaction: Prisma.TransactionClient,
    userId: string,
    gameDefinitionId: string,
    policy: RewardPolicy,
    requestedXp: bigint,
    requestedGld: bigint,
  ) {
    const now = new Date()
    const dayKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    // Serialize every reward settlement for this account/day, regardless of
    // game. A per-game ledger row lock alone allows concurrent games to each
    // observe the same remaining account-wide allowance.
    const accountDayLock = `match-reward-day:${userId}:${dayKey.toISOString().slice(0, 10)}`
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${accountDayLock}, 0))`
    const ledger = await transaction.matchRewardDailyLedger.upsert({
      where: { userId_gameDefinitionId_dayKey: { userId, gameDefinitionId, dayKey } },
      create: { userId, gameDefinitionId, dayKey },
      update: {},
    })
    await transaction.$queryRaw`SELECT "id" FROM "MatchRewardDailyLedger" WHERE "id" = ${ledger.id} FOR UPDATE`
    const lockedLedger = await transaction.matchRewardDailyLedger.findUniqueOrThrow({ where: { id: ledger.id } })
    const accountTotals = await transaction.matchRewardDailyLedger.aggregate({ where: { userId, dayKey }, _sum: { xpAwarded: true, gldAwarded: true } })
    const accountXp = accountTotals._sum.xpAwarded ?? 0n
    const accountGld = accountTotals._sum.gldAwarded ?? 0n
    const gameXpRemaining = policy.dailyGameXpCap > lockedLedger.xpAwarded ? policy.dailyGameXpCap - lockedLedger.xpAwarded : 0n
    const accountXpRemaining = policy.dailyAccountXpCap > accountXp ? policy.dailyAccountXpCap - accountXp : 0n
    const gldRemaining = policy.dailyGldCap > accountGld ? policy.dailyGldCap - accountGld : 0n
    const xp = this.min(requestedXp, this.min(gameXpRemaining, accountXpRemaining))
    const gld = this.min(requestedGld, gldRemaining)
    if (xp > 0n || gld > 0n) {
      await transaction.matchRewardDailyLedger.update({ where: { id: ledger.id }, data: { xpAwarded: { increment: xp }, gldAwarded: { increment: gld }, matchCount: { increment: 1 } } })
    }
    return { xp, gld }
  }

  private abs(value: bigint) { return value < 0n ? -value : value }
  private min(a: bigint, b: bigint) { return a < b ? a : b }
  private clamp(value: bigint, minimum: bigint, maximum: bigint) { return value < minimum ? minimum : value > maximum ? maximum : value }
  private ratio(numerator: bigint, denominator: bigint, cap: bigint) { return denominator <= 0n ? 0n : this.min(cap, (numerator * cap + denominator / 2n) / denominator) }
  private multiply(value: bigint, multiplier: string) {
    const [whole, fraction = ""] = multiplier.split(".")
    const scale = 10n ** BigInt(fraction.length)
    const scaled = BigInt(whole) * scale + BigInt(fraction || "0")
    const sign = value < 0n ? -1n : 1n
    const absolute = this.abs(value)
    return sign * ((absolute * scaled + scale / 2n) / scale)
  }

  private diminish(value: bigint, factor: number, repeats: number) {
    if (value <= 0n || repeats <= 0) return value
    return BigInt(Math.floor(Number(value) * Math.pow(factor, repeats)))
  }

  private getLeaderboardKeys(config: any) {
    const keys = (config.settings as Record<string, any> | null)?.leaderboardKeys
    if (!keys?.playerWeekly || !keys?.playerMonthly || !keys?.countryWeekly || !keys?.countryMonthly) throw new BadRequestException("Leaderboard keys are not configured for this game")
    return keys as { playerWeekly: string; playerMonthly: string; countryWeekly: string; countryMonthly: string }
  }
}
