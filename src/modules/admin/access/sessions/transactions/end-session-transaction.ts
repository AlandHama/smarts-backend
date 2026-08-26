import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"

@Injectable()
export class EndSessionTransaction extends PrismaTransaction<{ userId: string; tokenId: string }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; tokenId: string }, transaction: Prisma.TransactionClient) {
    await transaction.session.updateMany({
      where: { userId: data.userId, tokenId: data.tokenId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }
}
