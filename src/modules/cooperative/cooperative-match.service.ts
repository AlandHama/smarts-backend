import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { GameMode, MatchParticipantType, Prisma, WalletTransactionSourceType } from "@prisma/client"
import { createHash, randomBytes } from "node:crypto"
import { createAssignmentToken } from "../matches/utilities/server-content"

import { PrismaService } from "../../prisma.service"
import { DebitWalletTransaction } from "../economy/transactions/debit-wallet-transaction"

const publicUser = { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, level: true, elo: true, countryCode: true } } } satisfies Prisma.UserSelect

@Injectable()
export class CooperativeMatchService {
  constructor(private readonly prisma: PrismaService, private readonly debitWallet: DebitWalletTransaction) {}

  async getForPlayer(userId: string, matchId: string) {
    const row = await this.prisma.cooperativeMatch.findFirst({
      where: { matchId, participants: { some: { userId } } },
      include: {
        match: { select: { id: true, status: true, mode: true, startedAt: true, endedAt: true, createdAt: true, gameDefinition: { select: { key: true, name: true } } } },
        teams: { orderBy: { teamNumber: "asc" }, include: { participants: { orderBy: { createdAt: "asc" }, include: { user: { select: publicUser }, matchParticipant: { select: { result: true, readyAt: true, submittedAt: true } } } } } },
      },
    })
    if (!row) throw new NotFoundException("Cooperative match not found")
    return this.serialize(this.snapshot(row, userId))
  }

  async activeForPlayer(userId: string) {
    const row = await this.prisma.cooperativeMatch.findFirst({
      where: { participants: { some: { userId } }, match: { status: { in: ["CREATED", "STARTED", "FINISHED", "REVIEW", "SETTLED"] } } },
      orderBy: { createdAt: "desc" },
      select: { matchId: true },
    })
    return row ? this.getForPlayer(userId, row.matchId) : null
  }

  async adminMatches(options: { status?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const rows = await this.prisma.cooperativeMatch.findMany({
      where: options.status ? { status: options.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        match: { select: { id: true, status: true, mode: true, startedAt: true, endedAt: true, createdAt: true, gameDefinition: { select: { key: true, name: true } } } },
        teams: { orderBy: { teamNumber: "asc" }, include: { participants: { include: { user: { select: publicUser } } } } },
      },
    })
    return this.serialize(rows.map((row) => this.snapshot(row)))
  }

  snapshot(row: any, userId?: string) {
    return {
      id: row.id,
      matchId: row.matchId,
      format: row.format,
      mode: row.mode,
      status: row.status,
      botFilled: row.botFilled,
      confirmationDeadline: row.confirmationDeadline,
      disconnectGraceSeconds: row.disconnectGraceSeconds,
      policyVersion: row.policyVersion,
      rankingPolicyVersion: row.rankingPolicyVersion,
      entryFeeGld: row.entryFeeGld,
      stakeAmountGld: row.stakeAmountGld,
      payoutAmountGld: row.payoutAmountGld,
      commitmentAt: row.commitmentAt,
      settledAt: row.settledAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
      match: row.match ? { ...row.match, game: row.match.gameDefinition } : undefined,
      teams: (row.teams ?? []).map((team: any) => ({
        id: team.id,
        teamNumber: team.teamNumber,
        name: team.name,
        score: team.score,
        correctAnswers: team.correctAnswers,
        answeredQuestions: team.answeredQuestions,
        result: team.result,
        participants: (team.participants ?? []).map((participant: any) => ({
          id: participant.id,
          userId: participant.userId,
          participantType: participant.participantType,
          displayName: participant.displayName || participant.user?.profile?.displayName || participant.user?.username,
          avatarUrl: participant.avatarUrl || participant.user?.profile?.avatarUrl || null,
          level: participant.levelSnapshot,
          elo: participant.eloSnapshot,
          score: participant.finalScore,
          correctAnswers: participant.correctAnswers,
          answeredQuestions: participant.answeredQuestions,
          connectedAt: participant.connectedAt,
          disconnectedAt: participant.disconnectedAt,
          result: participant.matchParticipant?.result ?? "PENDING",
          readyAt: participant.matchParticipant?.readyAt ?? null,
          submittedAt: participant.matchParticipant?.submittedAt ?? null,
          isSelf: participant.userId === userId,
          confirmedAt: participant.confirmedAt,
        })),
      })),
    }
  }

  /** Confirms a found match and atomically commits the ranked entry fee for
   * every real participant. No wallet is charged until every human has
   * confirmed, so timeout/cancel paths remain free. */
  async confirm(userId: string, matchId: string) {
    await this.prisma.$transaction(async (tx) => {
      const match = await tx.cooperativeMatch.findUnique({ where: { matchId }, include: { participants: true, match: true } })
      if (!match) throw new NotFoundException("Cooperative match not found")
      const participant = match.participants.find((item) => item.userId === userId)
      if (!participant) throw new NotFoundException("Player is not a participant in this match")
      if (match.status === "COMMITTED" || match.status === "STARTED" || match.status === "SETTLED") return
      if (match.status !== "FOUND" || (match.confirmationDeadline && match.confirmationDeadline < new Date())) throw new ConflictException("This cooperative match is no longer accepting confirmations")
      await tx.cooperativeParticipant.update({ where: { id: participant.id }, data: { confirmedAt: new Date() } })
      const humans = match.participants.filter((item) => item.userId)
      const confirmations = await tx.cooperativeParticipant.findMany({ where: { cooperativeMatchId: match.id, userId: { not: null } }, select: { userId: true, confirmedAt: true } })
      if (confirmations.length < humans.length || confirmations.some((item) => !item.confirmedAt)) return

      const config = await tx.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} })
      const ranked = match.mode === "RANKED"
      const fee = ranked ? config.rankedEntryFeeGld.toString() : "0"
      const stake = ranked ? config.rankedStakeAmountGld.toString() : "0"
      const payout = ranked ? new Prisma.Decimal(stake).mul(humans.length).mul(new Prisma.Decimal(config.rankedPayoutPercent).div(100)).toString() : "0"
      for (const human of humans) {
        if (ranked && new Prisma.Decimal(fee).gt(0)) {
          const sourceId = `cooperative:${matchId}:entry:${human.userId}`
          const balance = await this.debitWallet.runWithinTransaction({ userId: human.userId!, currencyCode: "GLD", amount: BigInt(new Prisma.Decimal(fee).floor().toFixed(0)), amountDecimal: fee, sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_ENTRY, metadata: { cooperativeMatchId: matchId, mode: "RANKED" } }, tx)
          const walletTransaction = await tx.walletTransaction.findFirst({ where: { sourceId, sourceType: WalletTransactionSourceType.RANKING_MATCH_ENTRY }, orderBy: { createdAt: "desc" }, select: { id: true } })
          await tx.cooperativeLedgerOperation.upsert({ where: { idempotencyKey: sourceId }, create: { cooperativeMatchId: match.id, userId: human.userId!, operationType: "ENTRY_DEBIT", amount: new Prisma.Decimal(fee), walletTransactionId: walletTransaction?.id, idempotencyKey: sourceId, status: "CAPTURED", metadata: { balance: balance.exactAmount } as Prisma.InputJsonValue }, update: { status: "CAPTURED", walletTransactionId: walletTransaction?.id } })
        }
      }
      await tx.cooperativeMatch.update({ where: { id: match.id }, data: { status: "COMMITTED", commitmentAt: new Date(), entryFeeGld: fee, stakeAmountGld: stake, payoutAmountGld: payout, rankingPolicyVersion: ranked ? `cooperative.ranked.v1:${config.updatedAt.toISOString()}` : null } })
      await tx.party.updateMany({ where: { members: { some: { userId: { in: humans.map((item) => item.userId!).filter(Boolean) }, leftAt: null } }, status: "MATCH_FOUND" }, data: { status: "IN_MATCH" } })
    })
    return this.getForPlayer(userId, matchId)
  }

  /** Cancels unconfirmed found matches and keeps a small audit trail for
   * operations/reconciliation. */
  async expireConfirmations() {
    const rows = await this.prisma.cooperativeMatch.findMany({ where: { status: "FOUND", confirmationDeadline: { lt: new Date() } }, select: { id: true, matchId: true } })
    for (const row of rows) await this.prisma.$transaction(async (tx) => {
      const locked = await tx.cooperativeMatch.findUnique({ where: { id: row.id }, include: { participants: true, match: { select: { metadata: true } } } })
      if (!locked || locked.status !== "FOUND") return
      await tx.cooperativeMatch.update({ where: { id: row.id }, data: { status: "CANCELLED", endedAt: new Date() } })
      await tx.match.update({ where: { id: row.matchId }, data: { status: "CANCELLED", endedAt: new Date() } })
      await tx.cooperativeQueueEntry.updateMany({ where: { matchId: row.matchId, status: "MATCHED" }, data: { status: "CANCELLED", matchId: null } })
      const metadata = locked.match.metadata && typeof locked.match.metadata === "object" && !Array.isArray(locked.match.metadata) ? locked.match.metadata as Record<string, unknown> : {}
      const partyIds = Array.isArray(metadata.partyIds) ? metadata.partyIds.filter((value): value is string => typeof value === "string") : []
      if (partyIds.length) await tx.party.updateMany({ where: { id: { in: partyIds }, status: "MATCH_FOUND" }, data: { status: "READY", matchedAt: null } })
    })
    return rows.length
  }

  /** Converts disconnects past the grace period into authoritative forfeits. */
  async enforceDisconnectGrace() {
    const matches = await this.prisma.cooperativeMatch.findMany({ where: { status: "STARTED" }, include: { participants: true, match: { include: { participants: true } } } })
    let changed = 0
    for (const coop of matches) {
      const cutoff = new Date(Date.now() - coop.disconnectGraceSeconds * 1000)
      const overdue = coop.participants.filter((item) => item.userId && item.disconnectedAt && item.disconnectedAt < cutoff && !item.forfeitAt)
      if (!overdue.length) continue
      await this.prisma.$transaction(async (tx) => {
        for (const item of overdue) {
          await tx.cooperativeParticipant.update({ where: { id: item.id }, data: { forfeitAt: new Date(), abandonmentPenaltyApplied: true } })
          await tx.matchParticipant.update({ where: { id: item.matchParticipantId }, data: { result: "FORFEIT", submittedAt: new Date() } })
        }
        const pending = await tx.matchParticipant.count({ where: { matchId: coop.matchId, participantType: "PLAYER", result: "PENDING" } })
        if (!pending) await tx.match.update({ where: { id: coop.matchId }, data: { status: "FINISHED", endedAt: new Date() } })
      })
      changed += overdue.length
    }
    return changed
  }

  async settlementCandidates(limit = 20) {
    const policy = await this.prisma.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} })
    const rows = await this.prisma.cooperativeMatch.findMany({ where: { status: { in: ["COMMITTED", "STARTED"] }, match: { status: "FINISHED" } }, take: Math.min(limit * 2, 100), orderBy: { updatedAt: "asc" }, select: { id: true, matchId: true, participants: { where: { userId: { not: null } }, select: { userId: true } }, settlementAttempts: { orderBy: { attempt: "desc" }, take: 1, select: { attempt: true, status: true } } } })
    return rows.filter((row) => (row.settlementAttempts[0]?.attempt ?? 0) < policy.settlementRetryLimit || row.settlementAttempts[0]?.status === "PENDING").slice(0, limit)
  }

  async markSettlementAttempt(cooperativeMatchId: string, status: "SUCCEEDED" | "FAILED", error?: string) {
    const last = await this.prisma.cooperativeSettlementAttempt.findFirst({ where: { cooperativeMatchId }, orderBy: { attempt: "desc" }, select: { attempt: true } })
    const attempt = (last?.attempt ?? 0) + 1
    return this.prisma.cooperativeSettlementAttempt.create({ data: { cooperativeMatchId, attempt, status, error, completedAt: status === "SUCCEEDED" ? new Date() : null, nextAttemptAt: status === "SUCCEEDED" ? new Date() : new Date(Date.now() + Math.min(300, 2 ** Math.min(attempt, 8)) * 1000) } })
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T
  }

  /** Used by the queue worker. Kept here so all cooperative match creation is
   * transactionally consistent and the HTTP projection has one owner. */
  async claimNext() {
    const result = await this.prisma.$transaction(async (tx) => this.claimWithinTransaction(tx))
    return result
  }

  private async claimWithinTransaction(tx: Prisma.TransactionClient) {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended('smarts-cooperative-matchmaker', 0)) AS locked`
    if (!locked) return null

    const config = await tx.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} })
    if (!config.enabled || !config.cooperativePartyEnabled || (!config.cooperativeRandomEnabled && !config.cooperativeRankedEnabled)) return null

    const entries = await tx.cooperativeQueueEntry.findMany({
      where: { status: "SEARCHING", mode: { in: ["RANDOM", "RANKED"] }, expiresAt: { gt: new Date() }, lastHeartbeatAt: { gt: new Date(Date.now() - 120_000) }, party: { status: "QUEUED" } },
      orderBy: { queuedAt: "asc" },
      take: 40,
      include: { party: { include: { members: { where: { leftAt: null }, orderBy: { joinedAt: "asc" }, include: { user: { select: publicUser } } } } } },
    })
    const first = entries[0]
    if (!first || first.party.members.length < 1) return null
    const ranked = first.mode === "RANKED"
    if ((ranked && !config.cooperativeRankedEnabled) || (!ranked && !config.cooperativeRandomEnabled)) return null
    const elapsed = Math.max(0, Math.floor((Date.now() - first.queuedAt.getTime()) / 1000))
    const windowSize = Math.min(config.maxRatingWindow, config.initialRatingWindow + Math.floor(elapsed / Math.max(1, config.ratingWidenIntervalSeconds)) * config.initialRatingWindow)
    const second = entries.slice(1).find((candidate) => candidate.mode === first.mode && candidate.partyId !== first.partyId && Math.abs(candidate.ratingSnapshot - first.ratingSnapshot) <= windowSize && candidate.party.members.length > 0)
    const useBots = !second && (ranked ? config.cooperativeBotFillEnabled : config.cooperativeBotFillEnabled) && elapsed >= config.botFallbackDelaySeconds
    if (!second && !useBots) return null

    const games = await tx.gameDefinition.findMany({ where: { active: true, configs: { some: { active: true } }, content: { some: { active: true } } }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    const game = games[Math.floor(Math.random() * games.length)]
    const gameConfig = game?.configs[0]
    if (!game || !gameConfig) return null
    const content = await tx.gameContentItem.findMany({ where: { gameDefinitionId: game.id, active: true }, orderBy: { id: "asc" }, take: Math.max(1, gameConfig.maxQuestions) })
    if (!content.length) return null

    const now = new Date()
    const serverNonce = randomBytes(32).toString("base64url")
    const match = await tx.match.create({ data: { gameDefinitionId: game.id, gameConfigId: gameConfig.id, mode: GameMode.BOT, status: "CREATED", serverNonce, createdByUserId: first.party.hostUserId, metadata: { cooperative: true, source: ranked ? "COOPERATIVE_RANKED" : "COOPERATIVE_RANDOM", partyIds: [first.partyId, ...(second ? [second.partyId] : [])], botFilled: !second } as Prisma.InputJsonValue } })
    const round = await tx.matchRound.create({ data: { matchId: match.id, roundIndex: 1, gameDefinitionId: game.id, status: "CREATED", challengeSeedHash: createHash("sha256").update(`${serverNonce}:1`).digest("hex") } })
    const realMemberCount = first.party.members.length + (second ? second.party.members.length : 0)
    const cooperative = await tx.cooperativeMatch.create({ data: { matchId: match.id, gameDefinitionId: game.id, status: "FOUND", mode: first.mode, botFilled: !second, confirmationDeadline: new Date(now.getTime() + config.confirmationTimeoutSeconds * 1000), disconnectGraceSeconds: config.disconnectGraceSeconds, policyVersion: "cooperative.v2", rankingPolicyVersion: ranked ? `cooperative.ranked.v1:${config.updatedAt.toISOString()}` : null, entryFeeGld: ranked ? config.rankedEntryFeeGld : 0, stakeAmountGld: ranked ? config.rankedStakeAmountGld : 0, payoutAmountGld: ranked ? new Prisma.Decimal(config.rankedStakeAmountGld).mul(realMemberCount).mul(new Prisma.Decimal(config.rankedPayoutPercent).div(100)) : 0 } })
    const realMembers = [...first.party.members, ...(second ? second.party.members : [])]
    const participants: any[] = []
    for (const member of realMembers) participants.push(await tx.matchParticipant.create({ data: { matchId: match.id, userId: member.userId, participantType: MatchParticipantType.PLAYER } }))
    while (participants.length < 4) participants.push(await tx.matchParticipant.create({ data: { matchId: match.id, participantType: MatchParticipantType.BOT, result: "PENDING" } }))
    const teamRows = await Promise.all([1, 2].map((teamNumber) => tx.cooperativeTeam.create({ data: { cooperativeMatchId: cooperative.id, teamNumber, name: teamNumber === 1 ? "Your team" : "Rival team" } })))
    const firstCount = first.party.members.length
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index]
      const member = realMembers[index]
      const team = index < Math.max(2, firstCount) ? teamRows[0] : teamRows[1]
      const profile = member?.user?.profile
      await tx.cooperativeParticipant.create({ data: { cooperativeMatchId: cooperative.id, teamId: team.id, matchParticipantId: participant.id, userId: member?.userId, participantType: participant.participantType, displayName: member ? profile?.displayName || member.user.username : `SMARTS bot ${index + 1}`, avatarUrl: member ? profile?.avatarUrl ?? null : null, levelSnapshot: member ? profile?.level ?? 1 : 1, eloSnapshot: member ? profile?.elo ?? 0 : 0, confirmedAt: participant.participantType === MatchParticipantType.BOT ? now : null } })
      if (participant.participantType !== MatchParticipantType.BOT) {
        for (let position = 0; position < Math.min(content.length, gameConfig.maxQuestions); position += 1) {
          const token = createAssignmentToken(serverNonce, participant.id, round.id, position)
          const tokenHash = createHash("sha256").update(token).digest("hex")
          await tx.matchContentAssignment.create({ data: { matchId: match.id, roundId: round.id, participantId: participant.id, contentItemId: content[position].id, position, assignmentTokenHash: tokenHash, expiresAt: new Date(now.getTime() + gameConfig.maxMatchDurationSeconds * 1000) } })
        }
      }
    }
    const ids = [first.id, ...(second ? [second.id] : [])]
    await tx.cooperativeQueueEntry.updateMany({ where: { id: { in: ids }, status: "SEARCHING" }, data: { status: "MATCHED", matchId: match.id } })
    await tx.party.updateMany({ where: { id: { in: [first.partyId, ...(second ? [second.partyId] : [])] } }, data: { status: "MATCH_FOUND", matchedAt: now, queuedAt: null, expiresAt: new Date(now.getTime() + config.partyIdleMinutes * 60_000) } })
    return { matchId: match.id, userIds: realMembers.map((member) => member.userId), botFilled: !second, mode: first.mode }
  }
}
