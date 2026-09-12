import { ConflictException, Injectable } from "@nestjs/common"
import { Prisma, LeaderboardDirection, LeaderboardMemberType, LeaderboardPeriod, LeaderboardWritePolicy } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateLeaderboardDto } from "../dtos"
import { replaceLeaderboardRewards } from "../leaderboard-reward-configuration"

@Injectable()
export class CreateLeaderboardTransaction extends PrismaTransaction<CreateLeaderboardDto, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(dto: CreateLeaderboardDto, transaction: Prisma.TransactionClient) {
    if (dto.period !== LeaderboardPeriod.ALL_TIME && dto.period !== LeaderboardPeriod.WEEKLY && dto.period !== LeaderboardPeriod.MONTHLY && dto.period !== LeaderboardPeriod.SEASONAL) throw new ConflictException("Unsupported leaderboard period")
    if (dto.rewards?.length && dto.period === LeaderboardPeriod.ALL_TIME) throw new ConflictException("All-time leaderboards cannot renew and distribute placement rewards")
    try {
      const memberType = dto.memberType as LeaderboardMemberType
      const leaderboard = await transaction.leaderboard.create({ data: { key: dto.key.trim().toLowerCase(), name: dto.name.trim(), memberType, period: dto.period as LeaderboardPeriod, direction: dto.direction as LeaderboardDirection | undefined, writePolicy: dto.writePolicy as LeaderboardWritePolicy | undefined, active: dto.active ?? true, metadata: dto.metadata as Prisma.InputJsonValue | undefined } })
      if (dto.rewards) await replaceLeaderboardRewards(transaction, leaderboard.id, memberType, dto.rewards)
      return leaderboard
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Leaderboard key already exists")
      throw error
    }
  }
}
