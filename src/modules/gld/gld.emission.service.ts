import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { applyGldPolicyOverrides, getGldConfig } from "./gld.config";

type EmissionInput = {
  userId: string;
  baseAmount: bigint;
  baseAmountDecimal?: string;
  sourceId: string;
  exactAmount?: boolean;
  metadata?: Record<string, unknown>;
};

type AdRewardEstimateInput = {
  userId: string;
  baseAmount: bigint;
  baseAmountDecimal?: string;
  exactAmount?: boolean;
};

@Injectable()
export class GldEmissionService {
  async estimateAdReward(transaction: Prisma.TransactionClient, input: AdRewardEstimateInput) {
    const config = getGldConfig();
    const dateKey = new Date().toISOString().slice(0, 10);
    const controls = await transaction.gldAdminControl.findUnique({
      where: { singletonKey: "default" },
      select: { emissionsPaused: true, adDailyGldCap: true, adMaxValidatedAds: true, adMaxRewardPerClaim: true },
    });
    const effectiveConfig = applyGldPolicyOverrides(config, controls);
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { health: true } });
    const playerState = await transaction.gldPlayerDailyAdState.findUnique({
      where: { userId_dateKey: { userId: input.userId, dateKey } },
      select: { validatedAds: true, gldEarned: true, gldEarnedDecimal: true },
    });
    const validatedAds = playerState?.validatedAds ?? 0;
    const earned = playerState?.gldEarnedDecimal ?? new Prisma.Decimal(playerState?.gldEarned?.toString() ?? "0");
    const adNumber = validatedAds + 1;
    const remainingDailyAds = Math.max(effectiveConfig.adMaxValidatedAds - adNumber, 0);
    const cap = new Prisma.Decimal(effectiveConfig.adDailyGldCap.toString());
    const remainingCap = cap.gt(earned) ? cap.sub(earned) : new Prisma.Decimal(0);
    if (controls?.emissionsPaused) return this.result(new Prisma.Decimal(0), remainingDailyAds, remainingCap, "emissions-paused");

    const exact = Boolean(input.exactAmount || input.baseAmountDecimal !== undefined);
    const base = this.parseAmount(input.baseAmountDecimal ?? input.baseAmount.toString());
    const healthMultiplier = effectiveConfig.adHealthMultiplierBps[state?.health ?? "CRITICAL"] ?? 2_000;
    const curve = adNumber <= effectiveConfig.adMaxValidatedAds ? effectiveConfig.adCurve.find((row) => adNumber >= row.from && adNumber <= row.to) : undefined;
    const curveMultiplier = curve?.multiplierBps ?? 0;
    let amount = exact
      ? base
      : base.mul(curveMultiplier.toString()).mul(healthMultiplier.toString()).div(100_000_000);
    const maxClaim = new Prisma.Decimal(effectiveConfig.adMaxRewardPerClaim.toString());
    if (amount.gt(maxClaim)) amount = maxClaim;
    if (amount.gt(remainingCap)) amount = remainingCap;
    return this.result(amount, remainingDailyAds, remainingCap.sub(amount), amount.gt(0) ? null : curveMultiplier === 0 ? "daily-ad-limit-reached" : "daily-gld-cap-reached");
  }

  async issueAdReward(transaction: Prisma.TransactionClient, input: EmissionInput) {
    const base = this.parseAmount(input.baseAmountDecimal ?? input.baseAmount.toString());
    if (base.lte(0)) throw new BadRequestException("Ad reward amount is invalid");
    const config = getGldConfig();
    const dateKey = new Date().toISOString().slice(0, 10);
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gld-ad:${input.userId}:${dateKey}`}))`;
    const controls = await transaction.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} });
    const effectiveConfig = applyGldPolicyOverrides(config, controls);
    const empty = (reason: string) => ({ amount: 0n, amountDecimal: "0", validatedAds: 0, remainingDailyAds: effectiveConfig.adMaxValidatedAds, remainingDailyGldCap: effectiveConfig.adDailyGldCap, remainingDailyGldCapDecimal: effectiveConfig.adDailyGldCap.toString(), reason });
    if (controls.emissionsPaused) return empty("emissions-paused");
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { health: true, dailyEmissionBudget: true } });
    const healthMultiplier = effectiveConfig.adHealthMultiplierBps[state?.health ?? "CRITICAL"] ?? 2_000;
    const playerState = await transaction.gldPlayerDailyAdState.upsert({ where: { userId_dateKey: { userId: input.userId, dateKey } }, create: { userId: input.userId, dateKey }, update: {} });
    await transaction.$queryRaw`SELECT "id" FROM "GldPlayerDailyAdState" WHERE "id" = ${playerState.id} FOR UPDATE`;
    const lockedPlayer = await transaction.gldPlayerDailyAdState.findUniqueOrThrow({ where: { id: playerState.id } });
    const adNumber = lockedPlayer.validatedAds + 1;
    const curve = adNumber <= effectiveConfig.adMaxValidatedAds ? effectiveConfig.adCurve.find((row) => adNumber >= row.from && adNumber <= row.to) : undefined;
    const curveMultiplier = curve?.multiplierBps ?? 0;
    const exact = Boolean(input.exactAmount || input.baseAmountDecimal !== undefined);
    let amount = exact ? base : base.mul(curveMultiplier.toString()).mul(healthMultiplier.toString()).div(100_000_000);
    const maxClaim = new Prisma.Decimal(effectiveConfig.adMaxRewardPerClaim.toString());
    if (amount.gt(maxClaim)) amount = maxClaim;
    const earned = lockedPlayer.gldEarnedDecimal ?? new Prisma.Decimal(lockedPlayer.gldEarned.toString());
    const cap = new Prisma.Decimal(effectiveConfig.adDailyGldCap.toString());
    const remainingCap = cap.gt(earned) ? cap.sub(earned) : new Prisma.Decimal(0);
    if (amount.gt(remainingCap)) amount = remainingCap;
    const legacyAmount = BigInt(amount.floor().toFixed(0));
    const configuredBudget = state?.dailyEmissionBudget ?? 0n;
    const day = await transaction.gldEmissionDay.upsert({ where: { dateKey }, create: { dateKey, emissionBudget: configuredBudget }, update: {} });
    await transaction.$queryRaw`SELECT "id" FROM "GldEmissionDay" WHERE "id" = ${day.id} FOR UPDATE`;
    let lockedDay = await transaction.gldEmissionDay.findUniqueOrThrow({ where: { id: day.id } });
    if (lockedDay.emissionBudget < configuredBudget) lockedDay = await transaction.gldEmissionDay.update({ where: { id: lockedDay.id }, data: { emissionBudget: configuredBudget } });
    const price = await this.gldPrice(transaction);
    const rewardValueUsdMicros = amount.mul(price.toString()).floor();
    await transaction.gldPlayerDailyAdState.update({
      where: { id: lockedPlayer.id },
      data: {
        validatedAds: { increment: 1 },
        ...(amount.gt(0) ? { rewardedAds: { increment: 1 }, lastRewardedAt: new Date() } : {}),
        gldEarned: { increment: legacyAmount },
        gldEarnedDecimal: { increment: amount },
        rewardValueUsdMicros: { increment: BigInt(rewardValueUsdMicros.toFixed(0)) },
      },
    });
    if (amount.gt(0)) await transaction.gldEmissionDay.update({ where: { id: lockedDay.id }, data: { emittedAmount: { increment: legacyAmount }, adRewardAmount: { increment: legacyAmount }, emittedAmountDecimal: { increment: amount }, adRewardAmountDecimal: { increment: amount } } });
    return { amount: legacyAmount, amountDecimal: amount.toString(), validatedAds: adNumber, remainingDailyAds: Math.max(effectiveConfig.adMaxValidatedAds - adNumber, 0), remainingDailyGldCap: BigInt(remainingCap.sub(amount).floor().toFixed(0)), remainingDailyGldCapDecimal: remainingCap.sub(amount).toString(), reason: amount.gt(0) ? null : curveMultiplier === 0 ? "daily-ad-limit-reached" : "daily-gld-cap-reached" };
  }

  private result(amount: Prisma.Decimal, remainingDailyAds: number, remainingDailyGldCap: Prisma.Decimal, reason: string | null) {
    return { amount: BigInt(amount.floor().toFixed(0)), amountDecimal: amount.toString(), remainingDailyAds, remainingDailyGldCap: BigInt(remainingDailyGldCap.floor().toFixed(0)), remainingDailyGldCapDecimal: remainingDailyGldCap.toString(), reason };
  }

  private parseAmount(value: string) {
    const normalized = String(value).trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new BadRequestException("Ad reward amount must be a positive number with up to 6 decimals");
    return new Prisma.Decimal(normalized);
  }

  private async gldPrice(transaction: Prisma.TransactionClient) {
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { displayedValueUsdMicros: true } });
    return state?.displayedValueUsdMicros ?? getGldConfig().initialPriceUsdMicros;
  }
}
