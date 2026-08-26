import { Injectable, UnauthorizedException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { ChangePasswordRequestDto } from "../../../../auth/dtos/change-password-request.dto"

@Injectable()
export class ChangePasswordTransaction extends PrismaTransaction<
  { userId: string; dto: ChangePasswordRequestDto },
  { message: string }
> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; dto: ChangePasswordRequestDto }, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({ where: { id: data.userId } })
    if (!user || !(await HashHelper.compare(data.dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("Current password is invalid")
    }

    await transaction.user.update({
      where: { id: data.userId },
      data: { passwordHash: await HashHelper.encrypt(data.dto.newPassword) },
    })
    await transaction.session.updateMany({
      where: { userId: data.userId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })

    return { message: "Password changed. Please login again." }
  }
}
