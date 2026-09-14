import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { UpdateReferralConfigDto } from "../dtos"

@Injectable()
export class UpdateReferralConfigTransaction extends PrismaTransaction<{ dto: UpdateReferralConfigDto; adminId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { dto: UpdateReferralConfigDto; adminId: string }, transaction: Prisma.TransactionClient) {
    const before = await transaction.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    const data: Prisma.ReferralConfigUpdateInput = {
      ...(input.dto.enabled === undefined ? {} : { enabled: input.dto.enabled }),
      ...(input.dto.maxInvitesPerUser === undefined ? {} : { maxInvitesPerUser: input.dto.maxInvitesPerUser }),
      ...(input.dto.rewardBps === undefined ? {} : { rewardBps: input.dto.rewardBps }),
      ...(input.dto.maxRewardPerReferral === undefined ? {} : { maxRewardPerReferral: BigInt(input.dto.maxRewardPerReferral) }),
      ...(input.dto.minQualifyingAds === undefined ? {} : { minQualifyingAds: input.dto.minQualifyingAds }),
      updatedBy: { connect: { id: input.adminId } },
    }
    const updated = await transaction.referralConfig.update({ where: { id: before.id }, data })
    await writeAdminAudit(transaction, { actorId: input.adminId, action: "REFERRAL_CONFIG_UPDATED", entityType: "ReferralConfig", entityId: updated.id, reason: input.dto.reason, metadata: { before: { enabled: before.enabled, maxInvitesPerUser: before.maxInvitesPerUser, rewardBps: before.rewardBps, maxRewardPerReferral: before.maxRewardPerReferral, minQualifyingAds: before.minQualifyingAds }, after: { enabled: updated.enabled, maxInvitesPerUser: updated.maxInvitesPerUser, rewardBps: updated.rewardBps, maxRewardPerReferral: updated.maxRewardPerReferral, minQualifyingAds: updated.minQualifyingAds } } })
    return updated
  }
}

