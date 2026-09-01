import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import type { UpdateFeedbackDto } from "../dtos/storage.dto"

export type UpdateFeedbackInput = { id: string; dto: UpdateFeedbackDto; adminId: string }

@Injectable()
export class UpdateFeedbackTransaction extends PrismaTransaction<UpdateFeedbackInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: UpdateFeedbackInput, transaction: Prisma.TransactionClient) {
    const status = input.dto.status
    return transaction.playerFeedback.update({ where: { id: input.id }, data: { ...(status ? { status, resolvedAt: status === "RESOLVED" ? new Date() : null, resolvedBy: status === "RESOLVED" ? input.adminId : null } : {}), ...(input.dto.adminNote === undefined ? {} : { adminNote: input.dto.adminNote }) }, include: { category: true } })
  }
}
