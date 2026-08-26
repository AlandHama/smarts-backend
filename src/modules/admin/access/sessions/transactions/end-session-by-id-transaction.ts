import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"

@Injectable()
export class EndSessionByIdTransaction extends PrismaTransaction<{ userId: string; sessionId: string }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; sessionId: string }, transaction: Prisma.TransactionClient) {
    await transaction.session.updateMany({
      where: { id: data.sessionId, userId: data.userId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }
}
