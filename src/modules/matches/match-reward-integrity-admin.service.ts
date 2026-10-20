import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, ProgressionEventSourceType, WalletTransactionSourceType } from "@prisma/client"
import { randomUUID } from "node:crypto"

import { PrismaService } from "../../prisma.service"
import { AwardProgressionPointsTransaction } from "../progression/transactions/award-progression-points-transaction"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { SettleMatchTransaction } from "./transactions/settle-match-transaction"
import { MatchRewardCorrectionDto, MatchRewardReviewDto, UpdateMatchIntegrityPolicyDto } from "./dtos"

@Injectable()
export class MatchRewardIntegrityAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settle: SettleMatchTransaction,
    private readonly awardProgression: AwardProgressionPointsTransaction,
    private readonly creditWallet: CreditWalletTransaction,
  ) {}

  policies() {
    return this.prisma.matchIntegrityPolicy.findMany({ orderBy: [{ scopeKey: "asc" }, { version: "desc" }], take: 500 })
  }

  async updatePolicy(dto: UpdateMatchIntegrityPolicyDto, adminId: string) {
    const scopeKey = dto.scopeKey.trim().toLowerCase()
    const policy = await this.prisma.matchIntegrityPolicy.upsert({
      where: { scopeKey_version: { scopeKey, version: dto.version } },
      create: { scopeKey, gameKey: dto.gameKey?.trim().toLowerCase() || null, mode: dto.mode?.trim().toUpperCase() || null, version: dto.version, active: dto.active ?? true, killSwitch: dto.killSwitch ?? false, rolloutPercentage: dto.rolloutPercentage ?? 100, casualEnabled: dto.casualEnabled ?? true, rankedEnabled: dto.rankedEnabled ?? true, practiceEnabled: dto.practiceEnabled ?? true, settings: dto.settings as Prisma.InputJsonValue | undefined, createdById: adminId },
      update: { gameKey: dto.gameKey?.trim().toLowerCase(), mode: dto.mode?.trim().toUpperCase(), active: dto.active, killSwitch: dto.killSwitch, rolloutPercentage: dto.rolloutPercentage, casualEnabled: dto.casualEnabled, rankedEnabled: dto.rankedEnabled, practiceEnabled: dto.practiceEnabled, settings: dto.settings as Prisma.InputJsonValue | undefined, createdById: adminId },
    })
    await this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "MATCH_INTEGRITY_POLICY_UPDATED", entityType: "MatchIntegrityPolicy", entityId: policy.id, reason: dto.reason, metadata: { scopeKey, version: dto.version, killSwitch: policy.killSwitch, rolloutPercentage: policy.rolloutPercentage, active: policy.active } as Prisma.InputJsonValue } })
    return policy
  }

  async dashboard() {
    const since = new Date(Date.now() - 86400000)
    const matches = await this.prisma.match.findMany({ where: { createdAt: { gte: since } }, select: { id: true, mode: true, status: true, gameDefinition: { select: { key: true } }, participants: { select: { result: true, terminationReason: true, rewardEligibility: true } } } , take: 20000 })
    const summary = { started: 0, completed: 0, forfeited: 0, timedOut: 0, cancelled: 0, reviewed: 0, settled: 0, heldParticipants: 0, fullParticipants: 0, noneParticipants: 0, partialParticipants: 0 }
    const byGame: Record<string, { matches: number; settled: number; reviewed: number; forfeits: number; held: number }> = {}
    for (const match of matches) {
      if (match.status !== "CREATED") summary.started += 1
      if (match.status === "SETTLED") { summary.settled += 1; summary.completed += 1 }
      if (match.status === "REVIEW") summary.reviewed += 1
      if (match.status === "CANCELLED") summary.cancelled += 1
      const game = byGame[match.gameDefinition.key] ??= { matches: 0, settled: 0, reviewed: 0, forfeits: 0, held: 0 }
      game.matches += 1
      if (match.status === "SETTLED") game.settled += 1
      if (match.status === "REVIEW") game.reviewed += 1
      for (const participant of match.participants) {
        if (participant.result === "FORFEIT") { summary.forfeited += 1; game.forfeits += 1 }
        if (participant.terminationReason === "TIMEOUT") summary.timedOut += 1
        if (participant.rewardEligibility === "HELD") { summary.heldParticipants += 1; game.held += 1 }
        if (participant.rewardEligibility === "FULL") summary.fullParticipants += 1
        if (participant.rewardEligibility === "PARTIAL") summary.partialParticipants += 1
        if (participant.rewardEligibility === "NONE") summary.noneParticipants += 1
      }
    }
    const [holds, retryableOutbox, installs, signals] = await Promise.all([
      this.prisma.matchRewardHold.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: since } } }),
      this.prisma.outboxEvent.count({ where: { eventType: "MATCH_SETTLED", status: { in: ["FAILED", "PENDING"] }, createdAt: { gte: since } } }),
      this.prisma.playerInstall.count({ where: { lastSeenAt: { gte: since } } }),
      this.prisma.fraudSignal.count({ where: { occurredAt: { gte: since }, type: { in: ["MULTI_ACCOUNT_DEVICE", "INSTALL_ID_COLLISION", "NETWORK_ACCOUNT_CLUSTER", "MATCH_XP_VELOCITY", "MATCH_GLD_VELOCITY", "SAME_OPPONENT_FARMING", "BOT_REWARD_FARMING"] } } }),
    ])
    const alerts: Array<{ key: string; severity: "INFO" | "WARN" | "CRITICAL"; value: number; message: string }> = []
    if (summary.reviewed > 0) alerts.push({ key: "MATCH_REVIEWS", severity: "WARN", value: summary.reviewed, message: "Matches are awaiting reward-integrity review" })
    if (summary.heldParticipants > 0) alerts.push({ key: "REWARD_HOLDS", severity: "WARN", value: summary.heldParticipants, message: "Participant rewards are currently held" })
    if (retryableOutbox > 0) alerts.push({ key: "SETTLEMENT_RETRIES", severity: "CRITICAL", value: retryableOutbox, message: "Settlement/outbox work needs retry inspection" })
    if (signals > 0) alerts.push({ key: "FRAUD_SIGNALS", severity: "WARN", value: signals, message: "Device or match-farming signals were observed" })
    return { window: "24h", summary, byGame, rewardHolds: holds, settlementRetryCandidates: retryableOutbox, activeInstalls: installs, integritySignals: signals, alerts }
  }

  listHolds(status?: string) {
    return this.prisma.matchRewardHold.findMany({ where: status ? { status: status.toUpperCase() } : undefined, orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { id: true, username: true } }, match: { select: { id: true, mode: true, gameDefinition: { select: { key: true } } } }, matchParticipant: { select: { finalScore: true, rewardEligibility: true, rewardHoldReason: true } } } })
  }

  async releaseHold(holdId: string, dto: MatchRewardReviewDto, adminId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const hold = await transaction.matchRewardHold.findUnique({ where: { id: holdId }, include: { match: { include: { gameConfig: true } }, matchParticipant: true } })
      if (!hold) throw new NotFoundException("Reward hold not found")
      if (hold.status !== "HELD") return hold
      if (hold.heldXp > 0n) await this.awardProgression.runWithinTransaction({ userId: hold.userId, progressionKey: hold.match.gameConfig.mainProgressionKey, amount: hold.heldXp, sourceId: `${hold.id}:release:xp`, sourceType: ProgressionEventSourceType.ADMIN, actorId: adminId, reason: dto.reason, metadata: { matchId: hold.matchId, holdId, integrityReview: "RELEASED" } }, transaction)
      if (hold.heldGld > 0n) await this.creditWallet.runWithinTransaction({ userId: hold.userId, currencyCode: hold.match.gameConfig.rewardCurrencyCode, amount: hold.heldGld, sourceId: `${hold.id}:release:gld`, sourceType: WalletTransactionSourceType.ADMIN, actorId: adminId, reason: dto.reason, metadata: { matchId: hold.matchId, holdId, integrityReview: "RELEASED" } }, transaction)
      if (hold.heldElo !== 0n) await this.awardProgression.runWithinTransaction({ userId: hold.userId, progressionKey: hold.match.gameConfig.eloProgressionKey, amount: hold.heldElo, sourceId: `${hold.id}:release:elo`, sourceType: ProgressionEventSourceType.ADMIN, actorId: adminId, reason: dto.reason, metadata: { matchId: hold.matchId, holdId, integrityReview: "RELEASED" } }, transaction)
      await transaction.matchRewardHold.update({ where: { id: hold.id }, data: { status: "RELEASED", reviewedById: adminId, reviewedAt: new Date(), reviewNote: dto.reason } })
      await transaction.matchParticipant.update({ where: { id: hold.matchParticipantId }, data: { rewardEligibility: "FULL", rewardHoldReason: null } })
      await this.patchSettlement(transaction, hold.matchId, hold.matchParticipantId, { rewardEligibility: "FULL", rewardHoldReason: null, integrityReview: "RELEASED" })
      await transaction.adminAuditEvent.create({ data: { actorId: adminId, action: "MATCH_REWARD_HOLD_RELEASED", entityType: "MatchRewardHold", entityId: hold.id, reason: dto.reason, metadata: { matchId: hold.matchId, userId: hold.userId, heldXp: hold.heldXp.toString(), heldGld: hold.heldGld.toString(), heldElo: hold.heldElo.toString() } as Prisma.InputJsonValue } })
      return { status: "RELEASED", holdId: hold.id, matchId: hold.matchId, userId: hold.userId }
    })
  }

  async cancelHold(holdId: string, dto: MatchRewardReviewDto, adminId: string) {
    const hold = await this.prisma.matchRewardHold.findUnique({ where: { id: holdId } })
    if (!hold) throw new NotFoundException("Reward hold not found")
    if (hold.status !== "HELD") return hold
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.matchRewardHold.update({ where: { id: hold.id }, data: { status: "CANCELLED", reviewedById: adminId, reviewedAt: new Date(), reviewNote: dto.reason } })
      await transaction.matchParticipant.update({ where: { id: hold.matchParticipantId }, data: { rewardEligibility: "NONE", rewardHoldReason: "ADMIN_CANCELLED" } })
      await this.patchSettlement(transaction, hold.matchId, hold.matchParticipantId, { rewardEligibility: "NONE", rewardHoldReason: "ADMIN_CANCELLED", integrityReview: "CANCELLED" })
      await transaction.adminAuditEvent.create({ data: { actorId: adminId, action: "MATCH_REWARD_HOLD_CANCELLED", entityType: "MatchRewardHold", entityId: hold.id, reason: dto.reason, metadata: { matchId: hold.matchId, userId: hold.userId } as Prisma.InputJsonValue } })
      return { status: "CANCELLED", holdId: hold.id, matchId: hold.matchId }
    })
    return result
  }

  async retrySettlement(matchId: string, adminId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, select: { id: true, status: true, createdByUserId: true } })
    if (!match) throw new NotFoundException("Match not found")
    if (!["FINISHED", "REVIEW"].includes(match.status)) throw new ConflictException("Only finished or review matches can be retried")
    const result = await this.settle.run({ matchId, userId: match.createdByUserId, idempotencyKey: `admin-retry:${matchId}:${randomUUID()}` })
    await this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "MATCH_SETTLEMENT_RETRIED", entityType: "Match", entityId: matchId, reason: "System admin requested settlement retry", metadata: { status: match.status } } })
    return result
  }

  async replay(matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { gameDefinition: { select: { key: true, name: true } }, participants: { include: { user: { select: { id: true, username: true } } } }, events: { orderBy: { sequence: "asc" }, select: { sequence: true, participantId: true, eventType: true, accepted: true, rejectionReason: true, serverReceivedAt: true, payload: true } }, settlement: true } })
    if (!match) throw new NotFoundException("Match not found")
    return { match: { id: match.id, gameKey: match.gameDefinition.key, gameName: match.gameDefinition.name, mode: match.mode, status: match.status, integrityPolicyVersion: match.integrityPolicyVersion }, participants: match.participants.map((item) => ({ id: item.id, userId: item.userId, username: item.user?.username ?? "BOT", type: item.participantType, score: item.finalScore, result: item.result, eligibility: item.rewardEligibility })), events: match.events.map((event) => ({ ...event, payload: this.sanitizeReplay(event.payload) })), settlement: match.settlement ? this.sanitizeReplay(match.settlement.settlementJson) : null }
  }

  async correctProgression(userId: string, dto: MatchRewardCorrectionDto, adminId: string) {
    const amount = BigInt(dto.amount)
    const result = await this.awardProgression.run({ userId, progressionKey: dto.progressionKey, amount, sourceId: `integrity-correction:${userId}:${dto.idempotencyKey.trim()}`, sourceType: ProgressionEventSourceType.ADMIN, actorId: adminId, reason: dto.reason, metadata: { integrityCorrection: true, idempotencyKey: dto.idempotencyKey.trim() } })
    return result
  }

  private async patchSettlement(transaction: Prisma.TransactionClient, matchId: string, participantId: string, patch: Record<string, unknown>) {
    const settlement = await transaction.matchSettlement.findUnique({ where: { matchId }, select: { id: true, settlementJson: true } })
    if (!settlement || !settlement.settlementJson || typeof settlement.settlementJson !== "object" || Array.isArray(settlement.settlementJson)) return
    const participant = await transaction.matchParticipant.findUnique({ where: { id: participantId }, select: { userId: true } })
    const json = settlement.settlementJson as Record<string, unknown>
    const results = Array.isArray(json.results) ? json.results.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item
      const result = item as Record<string, unknown>
      return result.playerId === participantId || (participant?.userId && result.playerId === participant.userId) ? { ...result, ...patch } : item
    }) : json.results
    await transaction.matchSettlement.update({ where: { id: settlement.id }, data: { settlementJson: { ...json, results } as Prisma.InputJsonValue } })
  }

  private sanitizeReplay(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitizeReplay(item))
    if (!value || typeof value !== "object") return value
    const privateKeys = new Set(["serverNonce", "assignmentToken", "assignmentTokenHash", "answerIndex", "answerHash", "privateHand", "boneyard", "secret", "token"])
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !privateKeys.has(key)).map(([key, child]) => [key, this.sanitizeReplay(child)]))
  }
}
