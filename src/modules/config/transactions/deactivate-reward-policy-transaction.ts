import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class DeactivateRewardPolicyTransaction extends PrismaTransaction<string, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: string, transaction: Prisma.TransactionClient) {
    const key = input.trim().toLowerCase()
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
    const result = await transaction.rewardPolicyVersion.updateMany({ where: { key, active: true }, data: { active: false } })
    if (!result.count) throw new NotFoundException("Active reward policy not found")
    return { key, deactivated: result.count }
  }
}
