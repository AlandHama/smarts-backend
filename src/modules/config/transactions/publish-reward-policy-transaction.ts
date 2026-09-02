import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { PublishRewardPolicyDto } from "../dtos/reward-policy.dto"

@Injectable()
export class PublishRewardPolicyTransaction extends PrismaTransaction<PublishRewardPolicyDto, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: PublishRewardPolicyDto, transaction: Prisma.TransactionClient) {
    const key = input.key.trim().toLowerCase()
    if (!key) throw new BadRequestException("A policy key is required")
    // Advisory locks serialize versions for the same policy across Railway replicas.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
    const latest = await transaction.rewardPolicyVersion.findFirst({ where: { key }, orderBy: { version: "desc" }, select: { version: true } })
    const version = (latest?.version ?? 0) + 1
    if (input.active !== false) await transaction.rewardPolicyVersion.updateMany({ where: { key, active: true }, data: { active: false } })
    const policy = await transaction.rewardPolicyVersion.create({
      data: {
        key,
        version,
        active: input.active !== false,
        publicConfig: input.publicConfig as Prisma.InputJsonValue,
        privateConfig: input.privateConfig as Prisma.InputJsonValue,
      },
    })
    return { id: policy.id, key: policy.key, version: policy.version, active: policy.active, publicConfig: policy.publicConfig, createdAt: policy.createdAt }
  }
}
