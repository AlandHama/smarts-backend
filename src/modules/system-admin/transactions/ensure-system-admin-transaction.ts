import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateUserInput, CreateUserTransaction } from "../../admin/access/users/transactions/create-user-transaction"

export type EnsureSystemAdminInput = CreateUserInput & { lookupEmail?: string; resetPassword?: boolean }

@Injectable()
export class EnsureSystemAdminTransaction extends PrismaTransaction<EnsureSystemAdminInput, { created: boolean }> {
  constructor(
    prisma: PrismaService,
    private readonly createUserTransaction: CreateUserTransaction,
  ) {
    super(prisma)
  }

  protected async execute(dto: EnsureSystemAdminInput, transaction: Prisma.TransactionClient) {
    const username = dto.username.trim().toLowerCase()
    const lookupEmail = (dto.lookupEmail ?? dto.email).trim().toLowerCase()
    const existing = await transaction.user.findFirst({
      where: { OR: [{ username }, { email: lookupEmail }] },
      select: { id: true, isSystemAdmin: true },
    })
    if (existing) {
      if (!existing.isSystemAdmin) {
        await transaction.user.update({
          where: { id: existing.id },
          data: {
            isSystemAdmin: true,
            ...(dto.resetPassword ? { passwordHash: await HashHelper.encrypt(dto.password) } : {}),
          },
        })
      } else if (dto.resetPassword) {
        await transaction.user.update({
          where: { id: existing.id },
          data: { passwordHash: await HashHelper.encrypt(dto.password) },
        })
      }
      return { created: false }
    }

    await this.createUserTransaction.runWithinTransaction(
      {
        ...dto,
        isSystemAdmin: true,
      },
      transaction,
    )
    return { created: true }
  }
}
