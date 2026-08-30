import { ConflictException, Injectable } from "@nestjs/common"
import { Prisma, CurrencyKind } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateCurrencyDto } from "../dtos"

@Injectable()
export class CreateCurrencyTransaction extends PrismaTransaction<CreateCurrencyDto, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(dto: CreateCurrencyDto, transaction: Prisma.TransactionClient) {
    try {
      return await transaction.currencyDefinition.create({ data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), kind: dto.kind as CurrencyKind, precision: dto.precision ?? 0, active: dto.active ?? true, metadata: dto.metadata as Prisma.InputJsonValue | undefined } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Currency code already exists")
      throw error
    }
  }
}

