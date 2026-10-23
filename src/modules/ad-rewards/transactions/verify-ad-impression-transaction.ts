import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction";
import { PrismaService } from "../../../prisma.service";
import { ConfigService } from "../../config/config.service";
import { CreateAdImpressionDto } from "../dtos/ad-reward.dto";

type AdPolicy = {
  allowedProviders?: string[];
  allowedAdFormats?: string[];
  claimTtlSeconds?: number;
};

@Injectable()
export class VerifyAdImpressionTransaction extends PrismaTransaction<
  { userId: string; dto: CreateAdImpressionDto },
  any
> {
  constructor(
    prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super(prisma);
  }

  protected async execute(
    input: { userId: string; dto: CreateAdImpressionDto },
    transaction: Prisma.TransactionClient,
  ) {
    const provider = input.dto.provider.trim().toLowerCase();
    const adFormat = input.dto.adFormat.trim().toLowerCase();
    let policy: { version: string | number; privateConfig: AdPolicy };
    try {
      policy = await this.configService.getActivePrivate<AdPolicy>("ad-reward");
    } catch (error) {
      policy = { version: "gld-ad-reward-matrix", privateConfig: {} };
    }
    const configuredProviders =
      policy.privateConfig.allowedProviders ?? ["startio", "admob"];
    // Existing deployments may still have an `admob` policy saved. Treat it
    // as a migration-compatible policy so the Start.io client can switch over
    // without requiring an emergency admin config edit.
    const allowedProviders = new Set(configuredProviders);
    if (allowedProviders.has("admob")) allowedProviders.add("startio");
    const allowedFormats = policy.privateConfig.allowedAdFormats ?? [
      "rewarded",
    ];
    const configuredPlacement = await transaction.gldAdRewardPolicy.findFirst({
      where: { adFormat, enabled: true },
      select: { id: true },
    });
    if (
      !allowedProviders.has(provider) ||
      (!allowedFormats.includes(adFormat) && !configuredPlacement)
    )
      throw new BadRequestException("This ad reward placement is not enabled");
    const user = await transaction.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== "ACTIVE")
      throw new NotFoundException("Player account not found");
    const ttl =
      Number.isInteger(policy.privateConfig.claimTtlSeconds) &&
      (policy.privateConfig.claimTtlSeconds ?? 0) > 0
        ? policy.privateConfig.claimTtlSeconds!
        : 600;
    const claimToken = randomBytes(32).toString("base64url");
    const claim = await transaction.adRewardClaim.create({
      data: {
        userId: input.userId,
        provider,
        adFormat,
        claimTokenHash: createHash("sha256").update(claimToken).digest("hex"),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    return {
      claimId: claim.id,
      claimToken,
      provider: claim.provider,
      adFormat: claim.adFormat,
      expiresAt: claim.expiresAt,
      policyVersion: String(policy.version),
    };
  }
}
