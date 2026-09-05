import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { SystemAdminUserStatus } from "../dtos/update-user-status.dto"

@Injectable()
export class UpdateUserStatusTransaction extends PrismaTransaction<
  { userId: string; status: SystemAdminUserStatus; actorId: string; reason?: string },
  { id: string; status: string }
> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

    protected async execute(data: { userId: string; status: SystemAdminUserStatus; actorId: string; reason?: string }, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({ where: { id: data.userId }, select: { id: true, status: true, isSystemAdmin: true } })
    if (!user) throw new NotFoundException("User not found")
    if (user.id === data.actorId && data.status !== SystemAdminUserStatus.Active) {
      throw new ConflictException("You cannot deactivate or ban your own admin account")
    }
    if (user.isSystemAdmin && data.status !== SystemAdminUserStatus.Active) {
      const activeAdminCount = await transaction.user.count({ where: { isSystemAdmin: true, status: "ACTIVE" } })
      if (activeAdminCount <= 1) throw new ConflictException("The last active system admin cannot be deactivated or banned")
    }

    const updated = await transaction.user.update({
      where: { id: data.userId },
      data: { status: data.status },
      select: { id: true, status: true },
    })

    if (data.status !== SystemAdminUserStatus.Active) {
      await transaction.session.updateMany({
        where: { userId: data.userId, sessionStatus: "ACTIVE" },
        data: { sessionStatus: "TERMINATED" },
      })
    }

    await writeAdminAudit(transaction, { actorId: data.actorId, action: `USER_${data.status}`, entityType: "User", entityId: data.userId, reason: data.reason, metadata: { terminatedSessions: data.status !== SystemAdminUserStatus.Active } })
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.ADMIN, action: `ACCOUNT_${data.status}`, entityType: "User", entityId: data.userId, summary: `Account status changed from ${user.status} to ${data.status}`, changes: { status: { old: user.status, new: data.status } }, metadata: { actorId: data.actorId, terminatedSessions: data.status !== SystemAdminUserStatus.Active } })

    return updated
  }
}
