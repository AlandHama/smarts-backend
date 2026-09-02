import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { ConfigService } from "../../config/config.service"
import { CreateAdImpressionDto } from "../dtos/ad-reward.dto"

type AdPolicy = {
  allowedProviders?: string[]
  allowedAdFormats?: string[]
  claimTtlSeconds?: number
}

@Injectable()
export class VerifyAdImpressionTransaction extends PrismaTransaction<{ userId: string; dto: CreateAdImpressionDto }, any> {
  constructor(prisma: PrismaService, private readonly configService: ConfigService) { super(prisma) }

  protected async execute(input: { userId: string; dto: CreateAdImpressionDto }, transaction: Prisma.TransactionClient) {
    const provider = input.dto.provider.trim().toLowerCase()
    const adFormat = input.dto.adFormat.trim().toLowerCase()
    const policy = await this.configService.getActivePrivate<AdPolicy>("ad-reward")
    const allowedProviders = policy.privateConfig.allowedProviders ?? ["admob"]
    const allowedFormats = policy.privateConfig.allowedAdFormats ?? ["rewarded"]
    if (!allowedProviders.includes(provider) || !allowedFormats.includes(adFormat)) throw new BadRequestException("This ad reward placement is not enabled")
    const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } })
    if (!user || user.status !== "ACTIVE") throw new NotFoundException("Player account not found")
    const ttl = Number.isInteger(policy.privateConfig.claimTtlSeconds) && (policy.privateConfig.claimTtlSeconds ?? 0) > 0 ? policy.privateConfig.claimTtlSeconds! : 600
    const claimToken = randomBytes(32).toString("base64url")
    const claim = await transaction.adRewardClaim.create({
      data: {
        userId: input.userId,
        provider,
        adFormat,
        claimTokenHash: createHash("sha256").update(claimToken).digest("hex"),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    })
    return { claimId: claim.id, claimToken, provider: claim.provider, adFormat: claim.adFormat, expiresAt: claim.expiresAt, policyVersion: String(policy.version) }
  }
}
