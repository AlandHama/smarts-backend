import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, ProgressionRewardType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateProgressionRewardDto } from "../dtos"

export type ProgressionRewardInput = { tierId: string; dto: CreateProgressionRewardDto }

@Injectable()
export class CreateProgressionRewardTransaction extends PrismaTransaction<ProgressionRewardInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: ProgressionRewardInput, transaction: Prisma.TransactionClient) {
    const tier = await transaction.progressionTier.findUnique({ where: { id: data.tierId }, select: { id: true } })
    if (!tier) throw new NotFoundException("Progression tier not found")
    const dto = data.dto
    if (dto.rewardType === ProgressionRewardType.ASSET || dto.rewardType === ProgressionRewardType.ENTITLEMENT) {
      throw new BadRequestException("Asset and entitlement grants are reserved for a later migration phase")
    }
    const amount = dto.amount === undefined ? null : BigInt(dto.amount)
    if ((dto.rewardType === ProgressionRewardType.CURRENCY || dto.rewardType === ProgressionRewardType.PROGRESSION_POINTS) && (!amount || amount <= 0n)) {
      throw new BadRequestException("This reward type requires a positive amount")
    }
    const targetProgression = dto.targetProgressionKey ? await transaction.progressionDefinition.findUnique({ where: { key: dto.targetProgressionKey.trim().toLowerCase() }, select: { id: true } }) : null
    if (dto.rewardType === ProgressionRewardType.PROGRESSION_POINTS || dto.rewardType === ProgressionRewardType.PROGRESSION_RESET) {
      if (!targetProgression) throw new BadRequestException("A target progression key is required")
    }
    const currency = dto.currencyCode ? await transaction.currencyDefinition.findUnique({ where: { code: dto.currencyCode.trim().toUpperCase() }, select: { id: true } }) : null
    if (dto.rewardType === ProgressionRewardType.CURRENCY && !currency) throw new BadRequestException("Currency definition not found")
    return transaction.progressionTierReward.create({ data: {
      tierId: data.tierId,
      rewardType: dto.rewardType,
      targetProgressionId: targetProgression?.id,
      currencyId: currency?.id,
      targetKey: dto.targetKey?.trim(),
      amount,
      sortOrder: dto.sortOrder ?? 0,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    } })
  }
}

