import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"

@Injectable()
export class UpdateSessionLastActiveTransaction extends PrismaTransaction<string, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(sessionId: string, transaction: Prisma.TransactionClient) {
    await transaction.session.update({ where: { id: sessionId }, data: { lastActiveTimestamp: new Date() } })
  }
}
