import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { FraudActionType, FraudCaseStatus, FraudProfileStatus, FraudRiskLevel, FraudSignalStatus, Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { FraudActionDto, FraudProfilesQueryDto, UpdateFraudRuleDto } from "./dtos"

type ObserveInput = {
  type: string
  sourceType: string
  sourceId?: string
  metadata?: Record<string, unknown>
}

const DEFAULT_RULES = [
  { key: "MULTI_ACCOUNT_DEVICE", name: "Multi-account device", description: "Several player accounts share the same device fingerprint.", scoreDelta: 15, threshold: 3, windowSeconds: 86400, decayDays: 30, autoOpenScore: 60 },
  { key: "RAPID_AD_REWARDS", name: "Rapid ad rewards", description: "Rewarded ads are granted too frequently in a short period.", scoreDelta: 12, threshold: 10, windowSeconds: 1800, decayDays: 7, autoOpenScore: 60 },
  { key: "IMPOSSIBLE_ANSWER_SPEED", name: "Impossible answer speed", description: "Repeated answers arrive below the configured human response window.", scoreDelta: 8, threshold: 5, windowSeconds: 3600, decayDays: 14, autoOpenScore: 70 },
  { key: "REFERRAL_DEVICE_MATCH", name: "Referral device match", description: "Referred accounts share a device fingerprint with their referrer.", scoreDelta: 20, threshold: 1, windowSeconds: 86400, decayDays: 30, autoOpenScore: 60 },
  { key: "GLD_FUNNELING", name: "GLD funneling", description: "Many related accounts funnel GLD to one destination.", scoreDelta: 25, threshold: 5, windowSeconds: 86400, decayDays: 30, autoOpenScore: 60 },
  { key: "REPEATED_INVALID_EVENTS", name: "Repeated invalid events", description: "Repeated rejected or out-of-order authoritative events.", scoreDelta: 10, threshold: 15, windowSeconds: 3600, decayDays: 14, autoOpenScore: 70 },
  { key: "ABNORMAL_SESSION_SWITCHING", name: "Abnormal session switching", description: "Frequent device/session changes are detected for one account.", scoreDelta: 8, threshold: 6, windowSeconds: 3600, decayDays: 14, autoOpenScore: 70 },
  { key: "PAID_REWARD_REVIEW", name: "Paid reward review", description: "A paid reward request requires additional fraud review.", scoreDelta: 0, threshold: 60, windowSeconds: 86400, decayDays: 30, autoOpenScore: null },
]

@Injectable()
export class FraudService {
  constructor(private readonly prisma: PrismaService) {}

  async observe(userId: string, input: ObserveInput) {
    const key = input.type.trim().toUpperCase()
    const rule = await this.ensureRule(key)
    if (!rule.enabled) return this.getProfile(userId)
    const sourceId = input.sourceId?.trim() || "event"
    const dedupeKey = `${userId}:${key}:${input.sourceType.trim().toUpperCase()}:${sourceId}`.slice(0, 255)
    const windowStart = rule.windowSeconds && rule.windowSeconds > 0
      ? new Date(Date.now() - rule.windowSeconds * 1000)
      : null
    const recentCount = rule.threshold && rule.threshold > 1 && windowStart
      ? await this.prisma.fraudSignal.count({ where: { userId, type: key, status: FraudSignalStatus.ACTIVE, occurredAt: { gte: windowStart } } })
      : 0
    // Keep every observation as evidence, but only apply the configured score
    // when the configured event threshold is reached. This prevents a single
    // ordinary event from inflating risk while retaining the full timeline.
    const reachesThreshold = !rule.threshold || rule.threshold <= 1 || (recentCount + 1) % rule.threshold === 0
    const effectiveScoreDelta = reachesThreshold ? rule.scoreDelta : 0
    try {
      await this.prisma.fraudSignal.create({
        data: {
          userId,
          ruleId: rule.id,
          type: key,
          severity: this.levelForDelta(effectiveScoreDelta),
          scoreDelta: effectiveScoreDelta,
          sourceType: input.sourceType.trim().toUpperCase(),
          sourceId,
          dedupeKey,
          metadata: { ...input.metadata, threshold: rule.threshold, recentCount: recentCount + 1, thresholdReached: reachesThreshold } as Prisma.InputJsonValue,
          expiresAt: rule.decayDays > 0 ? new Date(Date.now() + rule.decayDays * 86400000) : null,
        },
      })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    }
    return this.recalculate(userId)
  }

  async observeSharedDevice(userId: string, deviceFingerprint: string) {
    const fingerprint = deviceFingerprint.trim()
    if (!fingerprint) return this.getProfile(userId)
    const related = await this.prisma.session.findMany({
      where: { userId: { not: userId }, deviceInfo: fingerprint, sessionStatus: "ACTIVE" },
      distinct: ["userId"],
      select: { userId: true },
      take: 20,
    })
    if (!related.length) return this.getProfile(userId)
    return this.observe(userId, {
      type: "MULTI_ACCOUNT_DEVICE",
      sourceType: "SESSION_DEVICE",
      sourceId: `${fingerprint}:${Date.now()}`,
      metadata: { relatedUserIds: related.map((item) => item.userId), relatedAccountCount: related.length },
    })
  }

  async ensureRule(key: string) {
    const preset = DEFAULT_RULES.find((item) => item.key === key)
    if (!preset) {
      return this.prisma.fraudRule.upsert({
        where: { key },
        create: { key, name: key.replaceAll("_", " "), description: "Custom fraud observation.", enabled: true },
        update: {},
      })
    }
    return this.prisma.fraudRule.upsert({ where: { key }, create: preset, update: {} })
  }

  async seedRules() {
    await Promise.all(DEFAULT_RULES.map((rule) => this.ensureRule(rule.key)))
    return this.prisma.fraudRule.findMany({ orderBy: { key: "asc" } })
  }

  async getMyStatus(userId: string) {
    const profile = await this.recalculate(userId)
    return {
      score: profile.score,
      riskLevel: profile.riskLevel,
      status: profile.status,
      lastEvaluatedAt: profile.lastEvaluatedAt,
      lastSignalAt: profile.lastSignalAt,
      canEarnRewards: profile.status !== FraudProfileStatus.RESTRICTED && profile.status !== FraudProfileStatus.SUSPENDED,
      canRequestPayout: profile.status === FraudProfileStatus.CLEAR || profile.status === FraudProfileStatus.WATCH,
      reviewRequired: profile.status === FraudProfileStatus.RESTRICTED || profile.score >= 60,
    }
  }

  async assertRewardAllowed(userId: string) {
    const profile = await this.recalculate(userId)
    if (profile.status === FraudProfileStatus.RESTRICTED || profile.status === FraudProfileStatus.SUSPENDED) {
      throw new ForbiddenException("Reward activity is temporarily restricted while this account is under review")
    }
  }

  async summary() {
    await this.seedRules()
    const [normal, low, suspicious, high, critical, cases, recentSignals] = await Promise.all([
      ...([FraudRiskLevel.NORMAL, FraudRiskLevel.LOW, FraudRiskLevel.SUSPICIOUS, FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL] as FraudRiskLevel[]).map((riskLevel) => this.prisma.fraudProfile.count({ where: { riskLevel } })),
      this.prisma.fraudCase.count({ where: { status: { in: [FraudCaseStatus.OPEN, FraudCaseStatus.IN_REVIEW, FraudCaseStatus.WATCH] } } }),
      this.prisma.fraudSignal.count({ where: { occurredAt: { gte: new Date(Date.now() - 86400000) } } }),
    ])
    return { byRiskLevel: { NORMAL: normal, LOW: low, SUSPICIOUS: suspicious, HIGH: high, CRITICAL: critical }, openCases: cases, signalsLast24Hours: recentSignals }
  }

  async listProfiles(query: FraudProfilesQueryDto) {
    await this.seedRules()
    const page = query.page ?? 1
    const limit = query.limit ?? 25
    const search = query.search?.trim()
    const where: Prisma.FraudProfileWhereInput = {
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search ? { user: { OR: [{ username: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }, { profile: { displayName: { contains: search, mode: "insensitive" } } }] } } : {}),
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fraudProfile.count({ where }),
      this.prisma.fraudProfile.findMany({ where, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, username: true, email: true, status: true, profile: { select: { displayName: true, avatarUrl: true } } } } } }),
    ])
    return this.serialize({ items: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  }

  async detail(userId: string) {
    const profile = await this.recalculate(userId)
    const [signals, cases, sessions] = await Promise.all([
      this.prisma.fraudSignal.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 200, include: { rule: { select: { key: true, name: true, decayDays: true } } } }),
      this.prisma.fraudCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { assignedAdmin: { select: { id: true, username: true } }, actions: { orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { username: true } } } } } }),
      this.prisma.session.findMany({ where: { userId }, orderBy: { lastActiveTimestamp: "desc" }, take: 50, select: { id: true, sessionStatus: true, platform: true, osName: true, osVersion: true, deviceType: true, deviceModel: true, deviceManufacturer: true, deviceInfo: true, ipAddress: true, loginTimestamp: true, lastActiveTimestamp: true } }),
    ])
    const deviceKeys = [...new Set(sessions.map((session) => session.deviceInfo).filter((value): value is string => Boolean(value)))]
    const related = deviceKeys.length ? await this.prisma.session.findMany({ where: { userId: { not: userId }, deviceInfo: { in: deviceKeys } }, distinct: ["userId"], take: 50, select: { userId: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } }) : []
    return this.serialize({ profile, signals, cases, sessions, relatedAccounts: related })
  }

  async listRules() {
    await this.seedRules()
    return this.serialize(await this.prisma.fraudRule.findMany({ orderBy: { key: "asc" } }))
  }

  async updateRule(id: string, dto: UpdateFraudRuleDto, adminId: string) {
    const rule = await this.prisma.fraudRule.update({ where: { id }, data: { enabled: dto.enabled, scoreDelta: dto.scoreDelta, threshold: dto.threshold, windowSeconds: dto.windowSeconds, decayDays: dto.decayDays, autoOpenScore: dto.autoOpenScore, metadata: dto.metadata as Prisma.InputJsonValue | undefined } })
    await this.prisma.adminAuditEvent.create({ data: { actorId: adminId, action: "FRAUD_RULE_UPDATED", entityType: "FraudRule", entityId: id, reason: dto.reason, metadata: this.serialize(dto) as unknown as Prisma.InputJsonValue } })
    return this.serialize(rule)
  }

  async action(userId: string, dto: FraudActionDto, actorId: string, caseId?: string) {
    if (dto.action === FraudActionType.RECALCULATE) return this.serialize({ profile: await this.recalculate(userId) })
    const profile = await this.prisma.fraudProfile.findUnique({ where: { userId } })
    if (!profile) throw new NotFoundException("Fraud profile not found")
    const nextStatus = dto.action === FraudActionType.MARK_SAFE || dto.action === FraudActionType.REINSTATE ? FraudProfileStatus.CLEAR : dto.action === FraudActionType.WATCH ? FraudProfileStatus.WATCH : dto.action === FraudActionType.RESTRICT_REWARDS ? FraudProfileStatus.RESTRICTED : dto.action === FraudActionType.SUSPEND ? FraudProfileStatus.SUSPENDED : profile.status
    const action = await this.prisma.$transaction(async (tx) => {
      if (dto.action === FraudActionType.MARK_SAFE) await tx.fraudSignal.updateMany({ where: { userId, status: FraudSignalStatus.ACTIVE }, data: { status: FraudSignalStatus.RESOLVED, resolvedAt: new Date() } })
      const updated = await tx.fraudProfile.update({ where: { userId }, data: { status: nextStatus, reviewedAt: new Date(), reviewedById: actorId } })
      const row = await tx.fraudAction.create({ data: { userId, actorId, caseId, action: dto.action, reason: dto.reason, metadata: dto.notes ? { notes: dto.notes } : undefined } })
      if (caseId) await tx.fraudCase.update({ where: { id: caseId }, data: { status: dto.caseStatus ?? (dto.action === FraudActionType.MARK_SAFE ? FraudCaseStatus.SAFE : undefined), notes: dto.notes, resolution: dto.action === FraudActionType.MARK_SAFE ? dto.reason : undefined, closedAt: dto.action === FraudActionType.MARK_SAFE ? new Date() : undefined } })
      await tx.adminAuditEvent.create({ data: { actorId, action: `FRAUD_${dto.action}`, entityType: "User", entityId: userId, reason: dto.reason, metadata: { caseId, notes: dto.notes } as Prisma.InputJsonValue } })
      return { profile: updated, action: row }
    })
    return this.serialize(action)
  }

  async recalculate(userId: string) {
    const signals = await this.prisma.fraudSignal.findMany({ where: { userId, status: FraudSignalStatus.ACTIVE }, include: { rule: { select: { decayDays: true } } } })
    const now = Date.now()
    let score = 0
    for (const signal of signals) {
      if (signal.expiresAt && signal.expiresAt.getTime() <= now) {
        await this.prisma.fraudSignal.update({ where: { id: signal.id }, data: { status: FraudSignalStatus.EXPIRED } })
        continue
      }
      const decayDays = signal.rule?.decayDays ?? 30
      const age = Math.max(0, now - signal.occurredAt.getTime())
      const factor = decayDays <= 0 ? 1 : Math.max(0, 1 - age / (decayDays * 86400000))
      score += Math.round(signal.scoreDelta * factor)
    }
    score = Math.max(0, Math.min(100, score))
    const riskLevel = this.riskLevel(score)
    const lastSignal = await this.prisma.fraudSignal.findFirst({ where: { userId }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } })
    const profile = await this.prisma.fraudProfile.upsert({ where: { userId }, create: { userId, score, riskLevel, lastEvaluatedAt: new Date(), lastSignalAt: lastSignal?.occurredAt }, update: { score, riskLevel, lastEvaluatedAt: new Date(), lastSignalAt: lastSignal?.occurredAt } })
    const openingRule = await this.prisma.fraudRule.findFirst({ where: { enabled: true, autoOpenScore: { not: null } }, orderBy: { autoOpenScore: "asc" }, select: { autoOpenScore: true } })
    if (openingRule?.autoOpenScore != null && score >= openingRule.autoOpenScore && profile.status === FraudProfileStatus.CLEAR) {
      const openCase = await this.prisma.fraudCase.findFirst({ where: { userId, status: { in: [FraudCaseStatus.OPEN, FraudCaseStatus.IN_REVIEW, FraudCaseStatus.WATCH] } } })
      if (!openCase) await this.prisma.fraudCase.create({ data: { userId, scoreAtOpen: score, reason: `Automated risk score reached ${score} (${riskLevel})` } })
    }
    return profile
  }

  private riskLevel(score: number): FraudRiskLevel { return score >= 80 ? FraudRiskLevel.CRITICAL : score >= 60 ? FraudRiskLevel.HIGH : score >= 40 ? FraudRiskLevel.SUSPICIOUS : score >= 20 ? FraudRiskLevel.LOW : FraudRiskLevel.NORMAL }
  private levelForDelta(delta: number): FraudRiskLevel { return delta >= 20 ? FraudRiskLevel.HIGH : delta >= 10 ? FraudRiskLevel.SUSPICIOUS : FraudRiskLevel.LOW }
  private getProfile(userId: string) { return this.prisma.fraudProfile.upsert({ where: { userId }, create: { userId }, update: {} }) }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
