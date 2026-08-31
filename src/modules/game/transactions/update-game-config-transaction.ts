import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateGameConfigDto } from "../dtos"

@Injectable()
export class UpdateGameConfigTransaction extends PrismaTransaction<{ gameKey: string; dto: UpdateGameConfigDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { gameKey: string; dto: UpdateGameConfigDto }, transaction: Prisma.TransactionClient) {
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.gameKey.trim().toLowerCase() }, select: { id: true } })
    if (!game) throw new NotFoundException("Game definition not found")
    await transaction.$queryRaw`SELECT "id" FROM "GameDefinition" WHERE "id" = ${game.id} FOR UPDATE`
    const current = await transaction.gameConfig.findFirst({ where: { gameDefinitionId: game.id, active: true }, orderBy: { version: "desc" } })
    if (!current) throw new NotFoundException("Game configuration not found")
    const dto = input.dto
    if (!Object.keys(dto).length) throw new ConflictException("No game configuration changes supplied")
    await transaction.gameConfig.update({ where: { id: current.id }, data: { active: false } })
    return transaction.gameConfig.create({ data: {
      gameDefinitionId: game.id,
      version: current.version + 1,
      active: true,
      mainProgressionKey: dto.mainProgressionKey?.trim().toLowerCase() ?? current.mainProgressionKey,
      eloProgressionKey: dto.eloProgressionKey?.trim().toLowerCase() ?? current.eloProgressionKey,
      rewardCurrencyCode: dto.rewardCurrencyCode?.trim().toUpperCase() ?? current.rewardCurrencyCode,
      scoreMultiplierForXp: dto.scoreMultiplierForXp ?? current.scoreMultiplierForXp,
      maxEloDelta: dto.maxEloDelta ?? current.maxEloDelta,
      soloEloScoreDivisor: dto.soloEloScoreDivisor ?? current.soloEloScoreDivisor,
      soloEloMaxDelta: dto.soloEloMaxDelta ?? current.soloEloMaxDelta,
      winnerBaseReward: dto.winnerBaseReward === undefined ? current.winnerBaseReward : BigInt(dto.winnerBaseReward),
      loserBaseReward: dto.loserBaseReward === undefined ? current.loserBaseReward : BigInt(dto.loserBaseReward),
      drawReward: dto.drawReward === undefined ? current.drawReward : BigInt(dto.drawReward),
      scoreRewardDivisor: dto.scoreRewardDivisor ?? current.scoreRewardDivisor,
      scoreRewardCap: dto.scoreRewardCap === undefined ? current.scoreRewardCap : BigInt(dto.scoreRewardCap),
      winnerRewardBonusMax: dto.winnerRewardBonusMax === undefined ? current.winnerRewardBonusMax : BigInt(dto.winnerRewardBonusMax),
      loserRewardBonusMax: dto.loserRewardBonusMax === undefined ? current.loserRewardBonusMax : BigInt(dto.loserRewardBonusMax),
      multiplayerRewardReference: dto.multiplayerRewardReference === undefined ? current.multiplayerRewardReference : BigInt(dto.multiplayerRewardReference),
      correctAnswerPoints: dto.correctAnswerPoints === undefined ? current.correctAnswerPoints as Prisma.InputJsonValue : dto.correctAnswerPoints as Prisma.InputJsonValue,
      wrongAnswerPenaltyPercent: dto.wrongAnswerPenaltyPercent ?? current.wrongAnswerPenaltyPercent,
      maxAnswerTimeSeconds: dto.maxAnswerTimeSeconds ?? current.maxAnswerTimeSeconds,
      maxMatchDurationSeconds: dto.maxMatchDurationSeconds ?? current.maxMatchDurationSeconds,
      maxQuestions: dto.maxQuestions ?? current.maxQuestions,
      rankingEnabled: dto.rankingEnabled ?? current.rankingEnabled,
      rankingEloMultiplier: dto.rankingEloMultiplier ?? current.rankingEloMultiplier,
      rankingLevelMultiplier: dto.rankingLevelMultiplier ?? current.rankingLevelMultiplier,
      rankingCoinMultiplier: dto.rankingCoinMultiplier ?? current.rankingCoinMultiplier,
      settings: dto.settings === undefined ? current.settings as Prisma.InputJsonValue | undefined : dto.settings as Prisma.InputJsonValue,
    }, include: { gameDefinition: true } })
  }
}
