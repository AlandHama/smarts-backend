import { BadRequestException, Injectable } from "@nestjs/common"
import { PlayerAuditActorType, PlayerStorageValueType, PlayerStorageVisibility, Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import type { PlayerStorageItemDto } from "../dtos/storage.dto"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { normalizeCountryCode } from "../../players/country-code"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { applyGldPolicyOverrides, getGldConfig } from "../../gld/gld.config"

const PUBLIC_KEYS = new Set(["player_country", "profile_url", "profile_file_id", "last_seen"])
const PRIVATE_KEYS = new Set(["player_age", "player_language"])
const STAT_SUFFIXES = new Set(["games_played", "accuracy", "wins", "losses", "answering_speed", "total_correct", "total_questions", "total_time_ms"])

export class UpdatePlayerStorageInput { userId!: string; payload!: PlayerStorageItemDto[] }

@Injectable()
export class UpdatePlayerStorageTransaction extends PrismaTransaction<UpdatePlayerStorageInput, any> {
  constructor(prisma: PrismaService, private readonly debitWallet: DebitWalletTransaction) { super(prisma) }

  protected async execute(input: UpdatePlayerStorageInput, transaction: Prisma.TransactionClient) {
    const keys = input.payload.map((item) => item.key)
    const existing = await transaction.playerStorageItem.findMany({ where: { userId: input.userId, key: { in: keys } }, select: { key: true, value: true, visibility: true, valueType: true, displayOrder: true } })
    const previous = new Map(existing.map((item) => [item.key, item]))
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const item of input.payload) {
      this.assertAllowedKey(item.key)
      const publicItem = item.isPublic ?? item.is_public ?? false
      const displayOrder = this.order(item.order, input.payload.indexOf(item))
      const prior = previous.get(item.key)
      changes[item.key] = { old: prior ? { value: prior.value, visibility: prior.visibility, valueType: prior.valueType, displayOrder: prior.displayOrder } : null, new: { value: item.value, visibility: publicItem ? PlayerStorageVisibility.PUBLIC : PlayerStorageVisibility.PRIVATE, valueType: this.valueType(item.key), displayOrder } }
      await transaction.playerStorageItem.upsert({
        where: { userId_key: { userId: input.userId, key: item.key } },
        create: { userId: input.userId, key: item.key, value: item.value, visibility: publicItem ? PlayerStorageVisibility.PUBLIC : PlayerStorageVisibility.PRIVATE, valueType: this.valueType(item.key), displayOrder },
        update: { value: item.value, visibility: publicItem ? PlayerStorageVisibility.PUBLIC : PlayerStorageVisibility.PRIVATE, valueType: this.valueType(item.key), displayOrder, version: { increment: 1 } },
      })
    }
    // `player_country` was historically stored as a public display name by
    // the mobile client. Keep that storage key for compatibility, but also
    // synchronize the authoritative profile field used by matchmaking and
    // country leaderboards.
    const countryItem = input.payload.find((item) => item.key === "player_country")
    const countryCode = normalizeCountryCode(countryItem?.value)
    if (countryItem && countryCode) {
      const profile = await transaction.playerProfile.findUnique({
        where: { userId: input.userId },
        select: { countryCode: true, countryChangeCount: true },
      })
      const countryChanged = profile != null && countryCode !== profile.countryCode
      if (countryChanged && profile) {
        const controls = await transaction.gldAdminControl.findUnique({ where: { singletonKey: "default" } })
        const config = applyGldPolicyOverrides(getGldConfig(), controls)
        const countryCost = profile.countryChangeCount > 0 ? config.countryChangeCostGld : 0n
        if (countryCost > 0n) {
          await this.debitWallet.runWithinTransaction({
            userId: input.userId,
            currencyCode: "GLD",
            amount: countryCost,
            sourceId: `profile-change:${input.userId}:storage:c${profile.countryChangeCount}`,
            sourceType: WalletTransactionSourceType.SYSTEM,
            metadata: {
              reason: "PROFILE_CHANGE",
              countryChanged: true,
              countryCost: countryCost.toString(),
              source: "PLAYER_STORAGE_COMPATIBILITY_PATH",
            },
          }, transaction)
        }
        await transaction.playerProfile.update({
          where: { userId: input.userId },
          data: { countryCode, countryChangeCount: { increment: 1 } },
        })
      }
    }
    const items = await transaction.playerStorageItem.findMany({ where: { userId: input.userId }, orderBy: [{ displayOrder: "asc" }, { key: "asc" }], take: 200 })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.PLAYER, action: "STORAGE_UPDATED", entityType: "PlayerStorageItem", summary: `Updated ${input.payload.length} player storage entr${input.payload.length === 1 ? "y" : "ies"}`, changes, metadata: { keys } })
    return items
  }

  private assertAllowedKey(key: string) {
    if (PUBLIC_KEYS.has(key) || PRIVATE_KEYS.has(key)) return
    const suffix = key.split("_").slice(1).join("_")
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !STAT_SUFFIXES.has(suffix)) throw new BadRequestException(`Storage key "${key}" is not supported`)
  }
  private valueType(key: string) { return key === "profile_url" ? PlayerStorageValueType.URL : key === "last_seen" ? PlayerStorageValueType.DATE : PlayerStorageValueType.STRING }
  private order(value: string | undefined, fallback: number) { const parsed = value ? Number(value) : fallback + 1; return Number.isInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : fallback + 1 }
}
