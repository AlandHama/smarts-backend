import { BadRequestException, ConflictException, Injectable } from "@nestjs/common"
import { Prisma, ProgressionKind, ProgressionResetPolicy } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateProgressionDto } from "../dtos"

@Injectable()
export class CreateProgressionTransaction extends PrismaTransaction<CreateProgressionDto, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(dto: CreateProgressionDto, transaction: Prisma.TransactionClient) {
    const key = dto.key.trim().toLowerCase()
    try {
      return await transaction.progressionDefinition.create({
        data: {
          key,
          name: dto.name.trim(),
          kind: dto.kind as ProgressionKind,
          active: dto.active ?? false,
          allowNegative: dto.allowNegative ?? false,
          resetPolicy: dto.resetPolicy as ProgressionResetPolicy | undefined,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Progression key already exists")
      }
      throw error
    }
  }
}

