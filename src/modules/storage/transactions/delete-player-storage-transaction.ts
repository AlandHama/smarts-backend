import { Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export class DeletePlayerStorageInput { userId!: string; key!: string }

@Injectable()
export class DeletePlayerStorageTransaction extends PrismaTransaction<DeletePlayerStorageInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: DeletePlayerStorageInput, transaction: Prisma.TransactionClient) {
    const item = await transaction.playerStorageItem.findUnique({ where: { userId_key: { userId: input.userId, key: input.key } } })
    if (!item) throw new NotFoundException("Storage entry not found")
    await transaction.playerStorageItem.delete({ where: { id: item.id } })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.PLAYER, action: "STORAGE_DELETED", entityType: "PlayerStorageItem", entityId: item.id, summary: `Deleted storage key ${item.key}`, changes: { [item.key]: { old: { value: item.value, visibility: item.visibility, valueType: item.valueType, displayOrder: item.displayOrder }, new: null } }, metadata: { key: item.key } })
    return { message: "Storage entry deleted" }
  }
}
