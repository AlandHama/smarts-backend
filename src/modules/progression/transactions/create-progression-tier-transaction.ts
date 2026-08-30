import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateProgressionTierDto } from "../dtos"

@Injectable()
export class CreateProgressionTierTransaction extends PrismaTransaction<{ progressionId: string; dto: CreateProgressionTierDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: { progressionId: string; dto: CreateProgressionTierDto }, transaction: Prisma.TransactionClient) {
    const progression = await transaction.progressionDefinition.findUnique({ where: { id: data.progressionId }, select: { id: true } })
    if (!progression) throw new NotFoundException("Progression definition not found")
    const threshold = BigInt(data.dto.pointsThreshold)
    const tiers = await transaction.progressionTier.findMany({ where: { progressionId: data.progressionId }, orderBy: { pointsThreshold: "asc" }, select: { step: true, pointsThreshold: true } })
    if (!tiers.length && (data.dto.step !== 1 || threshold !== 0n)) throw new BadRequestException("The first tier must be step 1 with a 0 point threshold")
    const previous = tiers.find((tier) => tier.step < data.dto.step)
    const next = tiers.find((tier) => tier.step > data.dto.step)
    if (previous && threshold <= previous.pointsThreshold) throw new BadRequestException("Tier thresholds must increase with step")
    if (next && threshold >= next.pointsThreshold) throw new BadRequestException("Tier thresholds must increase with step")
    try {
      return await transaction.progressionTier.create({ data: {
        progressionId: data.progressionId,
        step: data.dto.step,
        pointsThreshold: threshold,
        name: data.dto.name?.trim(),
        metadata: data.dto.metadata as Prisma.InputJsonValue | undefined,
      } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Tier step or threshold already exists")
      throw error
    }
  }
}

