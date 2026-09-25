import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  PlayerAuditActorType,
  Prisma,
  WalletTransactionSourceType,
} from "@prisma/client";

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction";
import { PrismaService } from "../../../prisma.service";
import { ConfigService } from "../../config/config.service";
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction";
import { ClaimAdRewardDto } from "../dtos/ad-reward.dto";
import { writePlayerAudit } from "../../../common/helpers/player-audit";
import { GldEmissionService } from "../../gld/gld.emission.service";
import { ReferralsService } from "../../referrals/referrals.service";

type AdPolicy = {
  currencyCode?: string;
  dailyCap?: number;
  dailyCapAmount?: string;
  cooldownSeconds?: number;
  rewards?: Record<
    string,
    { amount?: string; multiplierByCountry?: Record<string, string> }
  >;
};

export type TrustedAdProviderVerification = {
  source: "ADMOB_SSV" | "CLIENT_EVENT";
  payload: Record<string, string | null>;
};

type ClaimAdRewardInput = {
  dto: ClaimAdRewardDto;
  signature?: string;
  trustedVerification?: TrustedAdProviderVerification;
  serverRewardAmount?: bigint;
  serverRewardAmountDecimal?: string;
};

@Injectable()
export class ClaimAdRewardTransaction extends PrismaTransaction<
  ClaimAdRewardInput,
  any
> {
  constructor(
    prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly gldEmission: GldEmissionService,
    private readonly referralsService: ReferralsService,
  ) {
    super(prisma);
  }

  protected async execute(
    input: ClaimAdRewardInput,
    transaction: Prisma.TransactionClient,
  ) {
    const claim = await transaction.adRewardClaim.findUnique({
      where: { id: input.dto.claimId },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            profile: { select: { countryCode: true } },
          },
        },
      },
    });
    if (!claim || claim.user.status !== "ACTIVE")
      throw new NotFoundException("Ad reward claim not found");
    if (input.trustedVerification) {
      if (
        !["ADMOB_SSV", "CLIENT_EVENT"].includes(
          input.trustedVerification.source,
        ) ||
        claim.provider !== "admob"
      )
        throw new UnauthorizedException("Invalid ad provider");
    } else {
      if (!input.signature)
        throw new UnauthorizedException("Provider signature is required");
      const expectedSecret = process.env.AD_REWARD_WEBHOOK_SECRET?.trim();
      if (!expectedSecret)
        throw new UnauthorizedException(
          "Ad reward verification is not configured",
        );
      const canonical = `${claim.id}:${input.dto.providerEventId.trim()}:${input.dto.adFormat.trim().toLowerCase()}:${input.dto.claimToken}`;
      const expected = createHmac("sha256", expectedSecret)
        .update(canonical)
        .digest("hex");
      const supplied = input.signature.trim().toLowerCase();
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new UnauthorizedException("Invalid ad provider signature");
    }
    if (
      createHash("sha256").update(input.dto.claimToken).digest("hex") !==
      claim.claimTokenHash
    )
      throw new UnauthorizedException("Invalid ad claim token");
    if (claim.adFormat !== input.dto.adFormat.trim().toLowerCase())
      throw new BadRequestException("Ad format does not match the claim");

    if (claim.status === "GRANTED")
      return this.result(
        claim.rewardAmount,
        claim.rewardAmountDecimal,
        claim.currencyId,
        claim.grantedAt,
        "already-granted",
      );
    if (claim.status === "REJECTED")
      throw new ConflictException(
        claim.rejectionReason ?? "Ad reward claim was rejected",
      );
    if (claim.expiresAt <= new Date())
      return this.reject(transaction, claim.id, "Ad reward claim expired");

    let policy: { version: string | number; privateConfig: AdPolicy };
    try {
      policy = await this.configService.getActivePrivate<AdPolicy>("ad-reward");
    } catch (error) {
      if (input.trustedVerification?.source !== "CLIENT_EVENT") throw error;
      policy = {
        version: "gld-ad-reward-matrix",
        privateConfig: { currencyCode: "GLD", cooldownSeconds: 0 },
      };
    }
    const reward = policy.privateConfig.rewards?.[claim.adFormat];
    const baseAmount = input.serverRewardAmountDecimal ?? input.serverRewardAmount?.toString() ?? reward?.amount;
    const currencyCode =
      input.trustedVerification?.source === "CLIENT_EVENT"
        ? "GLD"
        : policy.privateConfig.currencyCode?.trim().toUpperCase();
    if (
      !currencyCode ||
      (!baseAmount && input.serverRewardAmount === undefined && input.serverRewardAmountDecimal === undefined) ||
      (baseAmount !== undefined && !/^\d+(?:\.\d{1,6})?$/.test(baseAmount)) ||
      (baseAmount !== undefined && new Prisma.Decimal(baseAmount).lte(0))
    )
      return this.reject(
        transaction,
        claim.id,
        "Ad reward policy is not configured",
      );
    const amountSource = input.serverRewardAmountDecimal ?? input.serverRewardAmount?.toString() ?? baseAmount!;
    let amountDecimal = new Prisma.Decimal(amountSource);
    let amount = BigInt(amountDecimal.floor().toFixed(0));
    const country = claim.user.profile?.countryCode?.trim().toUpperCase();
    const multiplier =
      input.serverRewardAmount !== undefined
        ? undefined
        : country
          ? reward?.multiplierByCountry?.[country]
          : undefined;
    if (multiplier) {
      amountDecimal = this.applyMultiplier(amountDecimal, multiplier);
      amount = BigInt(amountDecimal.floor().toFixed(0));
    }
    if (amount <= 0n && currencyCode !== "GLD")
      return this.reject(transaction, claim.id, "Ad reward amount is invalid");

    // Serialize claims per player so cooldown and daily caps cannot be bypassed
    // by concurrent provider callbacks.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ad-event:${claim.provider}:${input.dto.providerEventId.trim()}`}))`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim.userId || "ad-reward"}))`;
    const now = new Date();
    const providerEventId = input.dto.providerEventId.trim();
    const duplicate = await transaction.adRewardClaim.findFirst({
      where: {
        provider: claim.provider,
        providerEventId,
        id: { not: claim.id },
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException("This provider ad event was already claimed");
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const grantedToday = await transaction.adRewardClaim.findMany({
      where: {
        userId: claim.userId,
        status: "GRANTED",
        grantedAt: { gte: startOfDay },
      },
      select: { rewardAmount: true },
    });
    if (
      currencyCode !== "GLD" &&
      policy.privateConfig.dailyCap !== undefined &&
      grantedToday.length >= policy.privateConfig.dailyCap
    )
      return this.reject(
        transaction,
        claim.id,
        "Daily ad reward limit reached",
      );
    if (
      currencyCode !== "GLD" &&
      policy.privateConfig.dailyCapAmount &&
      /^\d+$/.test(policy.privateConfig.dailyCapAmount) &&
      grantedToday.reduce((sum, row) => sum + (row.rewardAmount ?? 0n), 0n) +
        amount >
        BigInt(policy.privateConfig.dailyCapAmount)
    )
      return this.reject(
        transaction,
        claim.id,
        "Daily ad reward amount limit reached",
      );
    const latest = await transaction.adRewardClaim.findFirst({
      where: { userId: claim.userId, status: "GRANTED" },
      orderBy: { grantedAt: "desc" },
      select: { grantedAt: true },
    });
    const cooldown =
      input.trustedVerification?.source === "CLIENT_EVENT"
        ? 0
        : Math.max(0, policy.privateConfig.cooldownSeconds ?? 0);
    if (
      latest?.grantedAt &&
      latest.grantedAt.getTime() + cooldown * 1000 > now.getTime()
    )
      return this.reject(transaction, claim.id, "Ad reward cooldown is active");

    let emission:
      Awaited<ReturnType<GldEmissionService["issueAdReward"]>> | undefined;
    if (currencyCode === "GLD") {
      emission = await this.gldEmission.issueAdReward(transaction, {
        userId: claim.userId,
        baseAmount: amount,
        baseAmountDecimal: amountDecimal.toString(),
        sourceId: claim.id,
        exactAmount: input.serverRewardAmount !== undefined || input.serverRewardAmountDecimal !== undefined,
        metadata: {
          provider: claim.provider,
          providerEventId,
          adFormat: claim.adFormat,
          countryCode: country ?? null,
        },
      });
      amount = emission.amount;
      amountDecimal = new Prisma.Decimal(emission.amountDecimal);
    }
    const referralSplit =
      currencyCode === "GLD"
        ? await this.referralsService.applyAdRewardShare(transaction, {
            referredUserId: claim.userId,
            adRewardClaimId: claim.id,
            grossAmount: amount,
            currencyCode,
          })
        : {
            playerAmount: amount,
            referralRewardAmount: 0n,
            referralId: null as string | null,
          };
    amount = referralSplit.playerAmount;
    if (currencyCode === "GLD" && referralSplit.referralRewardAmount > 0n) {
      amountDecimal = amountDecimal.sub(
        new Prisma.Decimal(referralSplit.referralRewardAmount.toString()),
      );
      if (amountDecimal.lt(0)) amountDecimal = new Prisma.Decimal(0);
      amount = BigInt(amountDecimal.floor().toFixed(0));
    }
    const hasReward = currencyCode === "GLD" ? amountDecimal.gt(0) : amount > 0n;
    const ledger =
      hasReward
        ? await this.creditWallet.runWithinTransaction(
            {
              userId: claim.userId,
              currencyCode,
              amount,
              ...(currencyCode === "GLD" ? { amountDecimal: amountDecimal.toString() } : {}),
              sourceId: claim.id,
              sourceType: WalletTransactionSourceType.AD,
              rewardGrantKey: `AD:${claim.id}`,
              policyVersion: String(policy.version),
              metadata: {
                provider: claim.provider,
                providerEventId,
                adFormat: claim.adFormat,
                countryCode: country ?? null,
                ...(emission ? { emissionReason: emission.reason } : {}),
              },
            },
            transaction,
          )
        : null;
    const currency = await transaction.currencyDefinition.findUnique({
      where: { code: currencyCode },
      select: { id: true },
    });
    const updated = await transaction.adRewardClaim.update({
      where: { id: claim.id },
      data: {
        providerEventId,
        countryCode: country ?? null,
        currencyId: currency?.id,
        rewardAmount: amount,
        rewardAmountDecimal: amountDecimal,
        status: "GRANTED",
        verificationPayload: {
          providerVerified: input.trustedVerification?.source === "ADMOB_SSV",
          clientEventAccepted:
            input.trustedVerification?.source === "CLIENT_EVENT",
          verificationSource: input.trustedVerification?.source ?? "HMAC",
          ...(input.trustedVerification
            ? { providerPayload: input.trustedVerification.payload }
            : {}),
          ...(emission
            ? {
                rewarded: hasReward,
                remainingDailyAds: emission.remainingDailyAds,
                remainingDailyGldCap: emission.remainingDailyGldCap.toString(),
                reason: emission.reason,
              }
            : {}),
        },
        verifiedAt: now,
        grantedAt: now,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        eventType: "ad-reward.granted",
        aggregateType: "AdRewardClaim",
        aggregateId: claim.id,
        payload: {
          claimId: claim.id,
          userId: claim.userId,
          amount: amountDecimal.toString(),
          currencyCode,
          ledger,
          ...(referralSplit.referralRewardAmount > 0n
            ? {
                grossAmount: (
                  amount + referralSplit.referralRewardAmount
                ).toString(),
                referralRewardAmount:
                  referralSplit.referralRewardAmount.toString(),
                referralId: referralSplit.referralId,
              }
            : {}),
          ...(emission
            ? {
                remainingDailyAds: emission.remainingDailyAds,
                remainingDailyGldCap: emission.remainingDailyGldCap.toString(),
                rewarded: hasReward,
                reason: emission.reason,
              }
            : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await writePlayerAudit(transaction, {
      userId: claim.userId,
      actorType: PlayerAuditActorType.SYSTEM,
      action: "AD_REWARD_GRANTED",
      entityType: "AdRewardClaim",
      entityId: claim.id,
      summary: `Granted ${amountDecimal.toString()} ${currencyCode} for a verified ad`,
      changes: {
        status: { old: claim.status, new: "GRANTED" },
        rewardAmount: { old: claim.rewardAmount ?? 0n, new: amount },
      },
      metadata: {
        provider: claim.provider,
        adFormat: claim.adFormat,
        providerEventId,
        eventType: input.trustedVerification?.payload.eventType ?? null,
        regionCode: input.trustedVerification?.payload.regionCode ?? null,
        currencyCode,
        policyVersion: policy.version,
      },
    });
    return {
      claimId: updated.id,
      status: updated.status,
      amount: amountDecimal.toString(),
      currencyCode,
      grantedAt: updated.grantedAt,
      rewarded: hasReward,
      ...(emission
        ? {
            remainingDailyAds: emission.remainingDailyAds,
            remainingDailyGldCap: emission.remainingDailyGldCap.toString(),
            reason: emission.reason,
          }
        : {}),
    };
  }

  private async reject(
    transaction: Prisma.TransactionClient,
    claimId: string,
    reason: string,
  ) {
    await transaction.adRewardClaim.update({
      where: { id: claimId },
      data: { status: "REJECTED", rejectionReason: reason },
    });
    throw new BadRequestException(reason);
  }

  private applyMultiplier(amount: Prisma.Decimal, value: string) {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value))
      throw new BadRequestException("Ad reward policy multiplier is invalid");
    return amount.mul(new Prisma.Decimal(value));
  }

  private result(
    amount: bigint | null,
    amountDecimal: Prisma.Decimal | null,
    currencyId: string | null,
    grantedAt: Date | null,
    status: string,
  ) {
    return {
      status,
      amount: amountDecimal?.toString() ?? amount?.toString() ?? null,
      currencyId,
      grantedAt,
    };
  }
}
