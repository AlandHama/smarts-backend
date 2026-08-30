import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, CurrencyKind } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateCurrencyDto } from "../dtos"

@Injectable()
export class UpdateCurrencyTransaction extends PrismaTransaction<{ id: string; dto: UpdateCurrencyDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: { id: string; dto: UpdateCurrencyDto }, transaction: Prisma.TransactionClient) {
    const current = await transaction.currencyDefinition.findUnique({ where: { id: data.id }, select: { id: true } })
    if (!current) throw new NotFoundException("Currency definition not found")
    try {
      return await transaction.currencyDefinition.update({ where: { id: data.id }, data: {
        ...(data.dto.code ? { code: data.dto.code.trim().toUpperCase() } : {}),
        ...(data.dto.name ? { name: data.dto.name.trim() } : {}),
        ...(data.dto.kind ? { kind: data.dto.kind as CurrencyKind } : {}),
        ...(data.dto.precision !== undefined ? { precision: data.dto.precision } : {}),
        ...(data.dto.active !== undefined ? { active: data.dto.active } : {}),
        ...(data.dto.metadata !== undefined ? { metadata: data.dto.metadata as Prisma.InputJsonValue } : {}),
      } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Currency code already exists")
      throw error
    }
  }
}

