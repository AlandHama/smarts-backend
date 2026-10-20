import { ConflictException, Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { GameMode, Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

export const DEFAULT_MATCH_INTEGRITY_POLICY_VERSION = "match-integrity-v3"

@Injectable()
export class MatchIntegrityPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(gameKey: string, mode: GameMode) {
    const key = gameKey.trim().toLowerCase()
    return (await this.findMostSpecific(this.prisma, key, mode)) ?? this.defaults(key, mode)
  }

  async getWithinTransaction(transaction: Prisma.TransactionClient, gameKey: string, mode: GameMode) {
    const key = gameKey.trim().toLowerCase()
    return (await this.findMostSpecific(transaction, key, mode)) ?? this.defaults(key, mode)
  }

  async assertAvailable(gameKey: string, mode: GameMode, userIds: string[], transaction?: Prisma.TransactionClient) {
    const policy = transaction ? await this.getWithinTransaction(transaction, gameKey, mode) : await this.get(gameKey, mode)
    if (policy.killSwitch || (mode === GameMode.CASUAL && !policy.casualEnabled) || (mode === GameMode.RANKED && !policy.rankedEnabled) || (mode === GameMode.PRACTICE && !policy.practiceEnabled)) throw new ConflictException("This game mode is temporarily unavailable")
    if (mode === GameMode.PRACTICE) return policy
    const rollout = Math.max(0, Math.min(100, policy.rolloutPercentage))
    if (rollout < 100 && userIds.some((userId) => this.bucket(`${policy.scopeKey}:${userId}`) >= rollout)) throw new ConflictException("This game is being enabled gradually")
    return policy
  }

  private defaults(gameKey: string, mode: GameMode) {
    return { scopeKey: `${gameKey}:${mode}`, version: 1, killSwitch: false, rolloutPercentage: 100, casualEnabled: true, rankedEnabled: true, practiceEnabled: true, active: true, gameKey, mode, settings: null }
  }

  private async findMostSpecific(client: PrismaService | Prisma.TransactionClient, key: string, mode: GameMode) {
    for (const scopeKey of [`${key}:${mode}`, `${key}:ALL`, "global"]) {
      const policy = await client.matchIntegrityPolicy.findFirst({ where: { active: true, scopeKey }, orderBy: { version: "desc" } })
      if (policy) return policy
    }
    return null
  }

  private bucket(value: string) { return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) % 100 }
}
