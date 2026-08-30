import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, LeaderboardDirection, LeaderboardMemberType, LeaderboardPeriod, LeaderboardWritePolicy } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateLeaderboardDto } from "../dtos"

@Injectable()
export class UpdateLeaderboardTransaction extends PrismaTransaction<{ id: string; dto: UpdateLeaderboardDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { id: string; dto: UpdateLeaderboardDto }, transaction: Prisma.TransactionClient) {
    const current = await transaction.leaderboard.findUnique({ where: { id: input.id }, select: { id: true } })
    if (!current) throw new NotFoundException("Leaderboard not found")
    try {
      return await transaction.leaderboard.update({ where: { id: input.id }, data: { ...(input.dto.key ? { key: input.dto.key.trim().toLowerCase() } : {}), ...(input.dto.name ? { name: input.dto.name.trim() } : {}), ...(input.dto.memberType ? { memberType: input.dto.memberType as LeaderboardMemberType } : {}), ...(input.dto.period ? { period: input.dto.period as LeaderboardPeriod } : {}), ...(input.dto.direction ? { direction: input.dto.direction as LeaderboardDirection } : {}), ...(input.dto.writePolicy ? { writePolicy: input.dto.writePolicy as LeaderboardWritePolicy } : {}), ...(input.dto.active !== undefined ? { active: input.dto.active } : {}), ...(input.dto.metadata !== undefined ? { metadata: input.dto.metadata as Prisma.InputJsonValue } : {}) } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Leaderboard key already exists")
      throw error
    }
  }
}
