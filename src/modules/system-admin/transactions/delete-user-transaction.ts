import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"

@Injectable()
export class DeleteUserTransaction extends PrismaTransaction<{ userId: string; actorId: string; reason?: string }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; actorId: string; reason?: string }, transaction: Prisma.TransactionClient) {
    if (data.userId === data.actorId) throw new ConflictException("You cannot delete your own admin account")

    const user = await transaction.user.findUnique({ where: { id: data.userId }, select: { id: true, isSystemAdmin: true, status: true } })
    if (!user) throw new NotFoundException("User not found")

    if (user.isSystemAdmin && user.status === "ACTIVE") {
      const adminCount = await transaction.user.count({ where: { isSystemAdmin: true, status: "ACTIVE" } })
      if (adminCount <= 1) throw new ConflictException("The last active system admin cannot be deleted")
    }

    await writeAdminAudit(transaction, { actorId: data.actorId, action: "USER_DELETE", entityType: "User", entityId: data.userId, reason: data.reason, metadata: { deletedSystemAdmin: user.isSystemAdmin } })
    await transaction.user.delete({ where: { id: data.userId } })
  }
}
