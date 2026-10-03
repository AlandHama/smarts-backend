import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CooperativePolicyDto } from "./dtos"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"

@Injectable()
export class CooperativeService {
  constructor(private readonly prisma: PrismaService, private readonly settleMatch: SettleMatchTransaction) {}

  policy() { return this.prisma.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} }) }

  async updatePolicy(dto: CooperativePolicyDto, adminId: string) {
    const normalized: Record<string, unknown> = { ...dto }
    if (dto.enabled !== undefined && dto.cooperativePartyEnabled === undefined) normalized.cooperativePartyEnabled = dto.enabled
    if (dto.randomEnabled !== undefined && dto.cooperativeRandomEnabled === undefined) normalized.cooperativeRandomEnabled = dto.randomEnabled
    if (dto.rankedEnabled !== undefined && dto.cooperativeRankedEnabled === undefined) normalized.cooperativeRankedEnabled = dto.rankedEnabled
    if (dto.botFillEnabled !== undefined && dto.cooperativeBotFillEnabled === undefined) normalized.cooperativeBotFillEnabled = dto.botFillEnabled
    if (dto.voiceEnabled !== undefined && dto.cooperativeVoiceEnabled === undefined) normalized.cooperativeVoiceEnabled = dto.voiceEnabled
    if (dto.rewardsEnabled !== undefined && dto.cooperativeRewardsEnabled === undefined) normalized.cooperativeRewardsEnabled = dto.rewardsEnabled
    const policy = await this.prisma.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default", ...(normalized as Prisma.CooperativeConfigurationCreateInput), updatedById: adminId }, update: { ...(normalized as Prisma.CooperativeConfigurationUpdateInput), updatedById: adminId } })
    await this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "COOPERATIVE_POLICY_UPDATED", entityType: "CooperativeConfiguration", entityId: policy.id, reason: "System administrator updated cooperative party policy", metadata: dto as Prisma.InputJsonValue } }).catch(() => undefined)
    return policy
  }

  async overview() {
    const [policy, parties, readyParties, queued, activeInvites, foundMatches, liveMatches, botMatches] = await Promise.all([
      this.policy(),
      this.prisma.party.count({ where: { status: { in: ["CREATED", "READY", "QUEUED"] } } }),
      this.prisma.party.count({ where: { status: "READY" } }),
      this.prisma.cooperativeQueueEntry.count({ where: { status: "SEARCHING" } }),
      this.prisma.partyInvite.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } }),
      this.prisma.cooperativeMatch.count({ where: { status: "FOUND" } }),
      this.prisma.cooperativeMatch.count({ where: { status: { in: ["FOUND", "STARTED"] } } }),
      this.prisma.cooperativeMatch.count({ where: { botFilled: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ])
    const [rankedSettlements, failedSettlements, pendingDebits] = await Promise.all([
      this.prisma.cooperativeMatch.count({ where: { mode: "RANKED", status: "SETTLED" } }),
      this.prisma.cooperativeSettlementAttempt.count({ where: { status: "FAILED" } }),
      this.prisma.cooperativeLedgerOperation.count({ where: { operationType: "ENTRY_DEBIT", status: { not: "CAPTURED" } } }),
    ])
    return { policy, parties, readyParties, queued, activeInvites, foundMatches, liveMatches, botMatchesLast24Hours: botMatches, rankedSettlements, failedSettlements, pendingDebits }
  }

  async settlements(options: { status?: string; mode?: string; limit?: number } = {}) {
    const rows = await this.prisma.cooperativeMatch.findMany({ where: { status: options.status || undefined, mode: options.mode || undefined }, orderBy: { updatedAt: "desc" }, take: Math.min(Math.max(options.limit ?? 50, 1), 200), include: { match: { select: { id: true, status: true, startedAt: true, endedAt: true, settledAt: true } }, participants: { select: { userId: true, displayName: true, participantType: true, forfeitAt: true } }, teams: { select: { id: true, teamNumber: true, score: true, result: true } }, ledgerOperations: { orderBy: { createdAt: "asc" } }, settlementAttempts: { orderBy: { attempt: "desc" }, take: 3 } } })
    return rows.map((row) => this.serialize(row))
  }

  async metrics(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000)
    const end = to ? new Date(to) : new Date()
    const [total, random, ranked, settled, abandoned, failedSettlements, operations] = await Promise.all([
      this.prisma.cooperativeMatch.count({ where: { createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeMatch.count({ where: { mode: "RANDOM", createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeMatch.count({ where: { mode: "RANKED", createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeMatch.count({ where: { status: "SETTLED", createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeParticipant.count({ where: { forfeitAt: { not: null }, createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeSettlementAttempt.count({ where: { status: "FAILED", createdAt: { gte: start, lte: end } } }),
      this.prisma.cooperativeLedgerOperation.aggregate({ where: { createdAt: { gte: start, lte: end } }, _sum: { amount: true }, _count: { _all: true } }),
    ])
    return { from: start, to: end, total, random, ranked, settled, abandoned, failedSettlements, ledgerOperations: operations._count._all, ledgerAmount: operations._sum.amount }
  }

  async exportHistory(from?: string, to?: string, mode?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000)
    const end = to ? new Date(to) : new Date()
    const rows = await this.prisma.cooperativeMatch.findMany({ where: { createdAt: { gte: start, lte: end }, mode: mode || undefined }, orderBy: { createdAt: "asc" }, include: { teams: { select: { teamNumber: true, score: true, result: true } }, ledgerOperations: { select: { operationType: true, amount: true, status: true } }, settlementAttempts: { orderBy: { attempt: "desc" }, take: 1, select: { status: true, error: true } } } })
    return this.serialize({ from: start, to: end, rows: rows.map((row) => ({ matchId: row.matchId, mode: row.mode, status: row.status, createdAt: row.createdAt, commitmentAt: row.commitmentAt, settledAt: row.settledAt, entryFeeGld: row.entryFeeGld, payoutAmountGld: row.payoutAmountGld, teams: row.teams, ledgerOperations: row.ledgerOperations, latestSettlementAttempt: row.settlementAttempts[0] || null })) })
  }

  async operationalAlerts() {
    const policy = await this.policy()
    if (!policy.hardeningAlertsEnabled) return []
    const [failed, openDebits, overdue] = await Promise.all([
      this.prisma.cooperativeSettlementAttempt.count({ where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      this.prisma.cooperativeLedgerOperation.count({ where: { status: { not: "CAPTURED" } } }),
      this.prisma.cooperativeMatch.count({ where: { status: "FOUND", confirmationDeadline: { lt: new Date() } } }),
    ])
    return [
      ...(failed ? [{ key: "COOPERATIVE_SETTLEMENT_FAILURE", severity: failed >= policy.settlementRetryLimit ? "CRITICAL" : "WARNING", count: failed, message: "Ranked cooperative settlements require reconciliation." }] : []),
      ...(openDebits ? [{ key: "COOPERATIVE_LEDGER_REVIEW", severity: "CRITICAL", count: openDebits, message: "GLD operations are not captured in the cooperative ledger." }] : []),
      ...(overdue ? [{ key: "COOPERATIVE_CONFIRMATION_TIMEOUT", severity: "INFO", count: overdue, message: "Found matches are past their confirmation window and will be cancelled by the worker." }] : []),
    ]
  }

  async retrySettlement(matchId: string, adminId: string) {
    const row = await this.prisma.cooperativeMatch.findUnique({ where: { matchId }, include: { participants: { where: { userId: { not: null } }, select: { userId: true } } } })
    if (!row || !row.participants[0]?.userId) throw new NotFoundException("Cooperative settlement not found")
    const result = await this.settleMatch.run({ matchId, userId: row.participants[0].userId, idempotencyKey: `cooperative-settle:${matchId}` })
    await this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "COOPERATIVE_SETTLEMENT_RETRIED", entityType: "CooperativeMatch", entityId: row.id, reason: "Administrator requested settlement reconciliation", metadata: { matchId } } }).catch(() => undefined)
    return result
  }

  async flagSettlementReview(matchId: string, adminId: string, reason: string) {
    const row = await this.prisma.cooperativeMatch.findUnique({ where: { matchId }, select: { id: true } })
    if (!row) throw new NotFoundException("Cooperative match not found")
    await this.prisma.$transaction([
      this.prisma.cooperativeMatch.update({ where: { id: row.id }, data: { status: "REVIEW" } }),
      this.prisma.match.update({ where: { id: matchId }, data: { status: "REVIEW" } }),
      this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "COOPERATIVE_SETTLEMENT_REVIEW", entityType: "CooperativeMatch", entityId: row.id, reason, metadata: { matchId } } }),
    ])
    return { matchId, status: "REVIEW" }
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" || item?.constructor?.name === "Decimal" ? item.toString() : item)) as T }
}
