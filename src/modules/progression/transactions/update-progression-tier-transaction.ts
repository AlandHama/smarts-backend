import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateProgressionTierDto } from "../dtos"

@Injectable()
export class UpdateProgressionTierTransaction extends PrismaTransaction<{ id: string; dto: UpdateProgressionTierDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(data: { id: string; dto: UpdateProgressionTierDto }, transaction: Prisma.TransactionClient) {
    const tier = await transaction.progressionTier.findUnique({ where: { id: data.id }, select: { id: true, progressionId: true, step: true, pointsThreshold: true } })
    if (!tier) throw new NotFoundException("Progression tier not found")
    const hasPlayers = await transaction.playerProgression.count({ where: { progressionId: tier.progressionId } })
    if (hasPlayers && (data.dto.step !== undefined || data.dto.pointsThreshold !== undefined)) {
      throw new BadRequestException("Tier thresholds cannot change after players have progression; create a new progression version")
    }
    const step = data.dto.step ?? tier.step
    const threshold = data.dto.pointsThreshold === undefined ? tier.pointsThreshold : BigInt(data.dto.pointsThreshold)
    if (step === 1 && threshold !== 0n) throw new BadRequestException("The first tier must have a 0 point threshold")
    const peers = await transaction.progressionTier.findMany({ where: { progressionId: tier.progressionId, id: { not: tier.id } }, select: { step: true, pointsThreshold: true } })
    if (peers.some((peer) => peer.step < step && peer.pointsThreshold >= threshold || peer.step > step && peer.pointsThreshold <= threshold)) throw new BadRequestException("Tier thresholds must increase with step")
    try {
      return await transaction.progressionTier.update({ where: { id: data.id }, data: {
        step,
        pointsThreshold: threshold,
        ...(data.dto.name !== undefined ? { name: data.dto.name?.trim() || null } : {}),
        ...(data.dto.metadata !== undefined ? { metadata: data.dto.metadata as Prisma.InputJsonValue } : {}),
      } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Tier step or threshold already exists")
      throw error
    }
  }
}

