import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { getGldConfig } from "./gld.config"

type EmissionInput = { userId: string; baseAmount: bigint; sourceId: string; metadata?: Record<string, unknown> }

@Injectable()
export class GldEmissionService {
  async issueAdReward(transaction: Prisma.TransactionClient, input: EmissionInput) {
    if (input.baseAmount <= 0n) throw new BadRequestException("Ad reward amount is invalid")
    const config = getGldConfig()
    const dateKey = new Date().toISOString().slice(0, 10)
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gld-ad:${input.userId}:${dateKey}`}))`
    const controls = await transaction.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    if (controls.emissionsPaused) return { amount: 0n, validatedAds: 0, remainingDailyAds: config.adMaxValidatedAds, remainingDailyGldCap: config.adDailyGldCap, reason: "emissions-paused" }
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { health: true, dailyEmissionBudget: true } })
    const healthMultiplier = config.adHealthMultiplierBps[state?.health ?? "CRITICAL"] ?? 2_000
    const playerState = await transaction.gldPlayerDailyAdState.upsert({ where: { userId_dateKey: { userId: input.userId, dateKey } }, create: { userId: input.userId, dateKey }, update: {} })
    await transaction.$queryRaw`SELECT "id" FROM "GldPlayerDailyAdState" WHERE "id" = ${playerState.id} FOR UPDATE`
    const lockedPlayer = await transaction.gldPlayerDailyAdState.findUniqueOrThrow({ where: { id: playerState.id } })
    const adNumber = lockedPlayer.validatedAds + 1
    const curve = adNumber <= config.adMaxValidatedAds ? config.adCurve.find((row) => adNumber >= row.from && adNumber <= row.to) : undefined
    const curveMultiplier = curve?.multiplierBps ?? 0
    let amount = input.baseAmount * BigInt(curveMultiplier) * BigInt(healthMultiplier) / 100_000_000n
    if (amount > config.adMaxRewardPerClaim) amount = config.adMaxRewardPerClaim
    const remainingCap = config.adDailyGldCap > lockedPlayer.gldEarned ? config.adDailyGldCap - lockedPlayer.gldEarned : 0n
    if (amount > remainingCap) amount = remainingCap

    const configuredBudget = state?.dailyEmissionBudget ?? 0n
    const day = await transaction.gldEmissionDay.upsert({ where: { dateKey }, create: { dateKey, emissionBudget: configuredBudget }, update: {} })
    await transaction.$queryRaw`SELECT "id" FROM "GldEmissionDay" WHERE "id" = ${day.id} FOR UPDATE`
    let lockedDay = await transaction.gldEmissionDay.findUniqueOrThrow({ where: { id: day.id } })
    if (lockedDay.emissionBudget < configuredBudget) {
      lockedDay = await transaction.gldEmissionDay.update({ where: { id: lockedDay.id }, data: { emissionBudget: configuredBudget } })
    }
    const available = lockedDay.emissionBudget > lockedDay.emittedAmount ? lockedDay.emissionBudget - lockedDay.emittedAmount : 0n
    if (amount > available) amount = available
    const price = await this.gldPrice(transaction)
    await transaction.gldPlayerDailyAdState.update({ where: { id: lockedPlayer.id }, data: { validatedAds: { increment: 1 }, ...(amount > 0n ? { rewardedAds: { increment: 1 }, lastRewardedAt: new Date() } : {}), gldEarned: { increment: amount }, rewardValueUsdMicros: { increment: amount * price } } })
    if (amount > 0n) await transaction.gldEmissionDay.update({ where: { id: lockedDay.id }, data: { emittedAmount: { increment: amount }, adRewardAmount: { increment: amount } } })
    return { amount, validatedAds: adNumber, remainingDailyAds: Math.max(config.adMaxValidatedAds - adNumber, 0), remainingDailyGldCap: remainingCap - amount, reason: amount > 0n ? null : available <= 0n ? "daily-emission-budget-exhausted" : curveMultiplier === 0 ? "daily-ad-limit-reached" : "daily-gld-cap-reached" }
  }

  private async gldPrice(transaction: Prisma.TransactionClient) {
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { displayedValueUsdMicros: true } })
    return state?.displayedValueUsdMicros ?? getGldConfig().initialPriceUsdMicros
  }
}
