import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, LeaderboardSeasonStatus } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateLeaderboardSeasonDto } from "../dtos"

@Injectable()
export class CreateSeasonTransaction extends PrismaTransaction<{ leaderboardId: string; dto: CreateLeaderboardSeasonDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { leaderboardId: string; dto: CreateLeaderboardSeasonDto }, transaction: Prisma.TransactionClient) {
    const startsAt = new Date(input.dto.startsAt)
    const endsAt = new Date(input.dto.endsAt)
    if (endsAt <= startsAt) throw new ConflictException("Season end must be after its start")
    const board = await transaction.leaderboard.findUnique({ where: { id: input.leaderboardId }, select: { id: true } })
    if (!board) throw new NotFoundException("Leaderboard not found")
    const overlap = await transaction.leaderboardSeason.findFirst({ where: { leaderboardId: input.leaderboardId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, status: { in: [LeaderboardSeasonStatus.SCHEDULED, LeaderboardSeasonStatus.ACTIVE] } }, select: { id: true } })
    if (overlap) throw new ConflictException("Season overlaps an existing scheduled or active season")
    return transaction.leaderboardSeason.create({ data: { leaderboardId: input.leaderboardId, startsAt, endsAt, status: startsAt <= new Date() && endsAt > new Date() ? LeaderboardSeasonStatus.ACTIVE : LeaderboardSeasonStatus.SCHEDULED } })
  }
}
