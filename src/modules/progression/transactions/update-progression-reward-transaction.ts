import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, ProgressionRewardType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateProgressionRewardDto } from "../dtos"

@Injectable()
export class UpdateProgressionRewardTransaction extends PrismaTransaction<{ id: string; dto: UpdateProgressionRewardDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: { id: string; dto: UpdateProgressionRewardDto }, transaction: Prisma.TransactionClient) {
    const reward = await transaction.progressionTierReward.findUnique({ where: { id: data.id }, select: { id: true, rewardType: true, targetProgressionId: true, currencyId: true, amount: true } })
    if (!reward) throw new NotFoundException("Progression reward not found")
    const dto = data.dto
    const rewardType = dto.rewardType ?? reward.rewardType
    if (rewardType === ProgressionRewardType.ASSET || rewardType === ProgressionRewardType.ENTITLEMENT) throw new BadRequestException("Asset and entitlement grants are reserved for a later migration phase")
    const amount = dto.amount === undefined ? reward.amount : BigInt(dto.amount)
    if ((rewardType === ProgressionRewardType.CURRENCY || rewardType === ProgressionRewardType.PROGRESSION_POINTS) && (!amount || amount <= 0n)) throw new BadRequestException("This reward type requires a positive amount")
    const targetProgression = dto.targetProgressionKey === undefined ? null : await transaction.progressionDefinition.findUnique({ where: { key: dto.targetProgressionKey.trim().toLowerCase() }, select: { id: true } })
    const targetProgressionId = dto.targetProgressionKey === undefined ? reward.targetProgressionId : targetProgression?.id
    if ((rewardType === ProgressionRewardType.PROGRESSION_POINTS || rewardType === ProgressionRewardType.PROGRESSION_RESET) && !targetProgressionId) throw new BadRequestException("A target progression key is required")
    const currency = dto.currencyCode === undefined ? null : await transaction.currencyDefinition.findUnique({ where: { code: dto.currencyCode.trim().toUpperCase() }, select: { id: true } })
    const currencyId = dto.currencyCode === undefined ? reward.currencyId : currency?.id
    if (rewardType === ProgressionRewardType.CURRENCY && !currencyId) throw new BadRequestException("Currency definition not found")
    return transaction.progressionTierReward.update({ where: { id: data.id }, data: {
      rewardType,
      amount,
      targetProgressionId: targetProgressionId ?? null,
      currencyId: currencyId ?? null,
      ...(dto.targetKey !== undefined ? { targetKey: dto.targetKey.trim() || null } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
    } })
  }
}
