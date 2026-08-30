import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export interface ResetUserPasswordInput {
  userId: string
  actorId: string
  password: string
}

@Injectable()
export class ResetUserPasswordTransaction extends PrismaTransaction<ResetUserPasswordInput, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: ResetUserPasswordInput, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({ where: { id: data.userId }, select: { id: true } })
    if (!user) throw new NotFoundException("User not found")

    await transaction.user.update({
      where: { id: data.userId },
      data: { passwordHash: await HashHelper.encrypt(data.password) },
    })
    await transaction.session.updateMany({
      where: { userId: data.userId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }
}
