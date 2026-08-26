import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { SystemAdminUserStatus } from "../dtos/update-user-status.dto"

@Injectable()
export class UpdateUserStatusTransaction extends PrismaTransaction<
  { userId: string; status: SystemAdminUserStatus; actorId: string },
  { id: string; status: string }
> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; status: SystemAdminUserStatus; actorId: string }, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({ where: { id: data.userId }, select: { id: true, isSystemAdmin: true } })
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

    return updated
  }
}
