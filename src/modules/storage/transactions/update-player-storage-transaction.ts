import { BadRequestException, Injectable } from "@nestjs/common"
import { PlayerAuditActorType, PlayerStorageValueType, PlayerStorageVisibility, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import type { PlayerStorageItemDto } from "../dtos/storage.dto"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

const PUBLIC_KEYS = new Set(["player_country", "profile_url", "profile_file_id", "last_seen"])
const STAT_SUFFIXES = new Set(["games_played", "accuracy", "wins", "losses", "answering_speed", "total_correct", "total_questions", "total_time_ms"])

export class UpdatePlayerStorageInput { userId!: string; payload!: PlayerStorageItemDto[] }

@Injectable()
export class UpdatePlayerStorageTransaction extends PrismaTransaction<UpdatePlayerStorageInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: UpdatePlayerStorageInput, transaction: Prisma.TransactionClient) {
    for (const item of input.payload) {
      this.assertAllowedKey(item.key)
      const publicItem = item.isPublic ?? item.is_public ?? false
      const displayOrder = this.order(item.order, input.payload.indexOf(item))
      await transaction.playerStorageItem.upsert({
        where: { userId_key: { userId: input.userId, key: item.key } },
        create: { userId: input.userId, key: item.key, value: item.value, visibility: publicItem ? PlayerStorageVisibility.PUBLIC : PlayerStorageVisibility.PRIVATE, valueType: this.valueType(item.key), displayOrder },
        update: { value: item.value, visibility: publicItem ? PlayerStorageVisibility.PUBLIC : PlayerStorageVisibility.PRIVATE, valueType: this.valueType(item.key), displayOrder, version: { increment: 1 } },
      })
    }
    const items = await transaction.playerStorageItem.findMany({ where: { userId: input.userId }, orderBy: [{ displayOrder: "asc" }, { key: "asc" }], take: 200 })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.PLAYER, action: "STORAGE_UPDATED", entityType: "PlayerStorageItem", summary: `Updated ${input.payload.length} player storage entr${input.payload.length === 1 ? "y" : "ies"}`, metadata: { keys: input.payload.map((item) => item.key) } })
    return items
  }

  private assertAllowedKey(key: string) {
    if (PUBLIC_KEYS.has(key)) return
    const suffix = key.split("_").slice(1).join("_")
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !STAT_SUFFIXES.has(suffix)) throw new BadRequestException(`Storage key "${key}" is not supported`)
  }
  private valueType(key: string) { return key === "profile_url" ? PlayerStorageValueType.URL : key === "last_seen" ? PlayerStorageValueType.DATE : PlayerStorageValueType.STRING }
  private order(value: string | undefined, fallback: number) { const parsed = value ? Number(value) : fallback + 1; return Number.isInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : fallback + 1 }
}
