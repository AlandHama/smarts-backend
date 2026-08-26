import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"

@Injectable()
export class EndAllSessionsTransaction extends PrismaTransaction<string, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(userId: string, transaction: Prisma.TransactionClient) {
    await transaction.session.updateMany({
      where: { userId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }
}
