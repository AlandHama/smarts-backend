import { Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export class RemoveFriendshipInput { userId!: string; friendId!: string }

@Injectable()
export class RemoveFriendshipTransaction extends PrismaTransaction<RemoveFriendshipInput, { message: string }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: RemoveFriendshipInput, transaction: Prisma.TransactionClient) {
    const result = await transaction.friendship.deleteMany({ where: { OR: [{ userId: input.userId, friendId: input.friendId }, { userId: input.friendId, friendId: input.userId }] } })
    if (!result.count) throw new NotFoundException("Friendship not found")
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.PLAYER, action: "FRIENDSHIP_REMOVED", entityType: "Friendship", summary: "Removed a friendship", metadata: { friendId: input.friendId } })
    await writePlayerAudit(transaction, { userId: input.friendId, actorType: PlayerAuditActorType.SYSTEM, action: "FRIENDSHIP_REMOVED", entityType: "Friendship", summary: "A friendship was removed", metadata: { friendId: input.userId } })
    return { message: "Friendship removed" }
  }
}
