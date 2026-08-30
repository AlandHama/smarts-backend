import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, ProgressionKind, ProgressionResetPolicy } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateProgressionDto } from "../dtos"

@Injectable()
export class UpdateProgressionTransaction extends PrismaTransaction<{ id: string; dto: UpdateProgressionDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: { id: string; dto: UpdateProgressionDto }, transaction: Prisma.TransactionClient) {
    const existing = await transaction.progressionDefinition.findUnique({ where: { id: data.id }, select: { id: true } })
    if (!existing) throw new NotFoundException("Progression definition not found")
    if (data.dto.active === true) {
      const tierCount = await transaction.progressionTier.count({ where: { progressionId: data.id } })
      if (!tierCount) throw new BadRequestException("Add at least one tier before activating a progression")
    }
    return transaction.progressionDefinition.update({
      where: { id: data.id },
      data: {
        ...(data.dto.key ? { key: data.dto.key.trim().toLowerCase() } : {}),
        ...(data.dto.name ? { name: data.dto.name.trim() } : {}),
        ...(data.dto.kind ? { kind: data.dto.kind as ProgressionKind } : {}),
        ...(data.dto.active !== undefined ? { active: data.dto.active } : {}),
        ...(data.dto.allowNegative !== undefined ? { allowNegative: data.dto.allowNegative } : {}),
        ...(data.dto.resetPolicy ? { resetPolicy: data.dto.resetPolicy as ProgressionResetPolicy } : {}),
        ...(data.dto.metadata !== undefined ? { metadata: data.dto.metadata as Prisma.InputJsonValue } : {}),
      },
    })
  }
}

