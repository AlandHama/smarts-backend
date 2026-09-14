import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { ClaimReferralDto } from "../dtos"

@Injectable()
export class ClaimReferralTransaction extends PrismaTransaction<{ userId: string; dto: ClaimReferralDto }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { userId: string; dto: ClaimReferralDto }, transaction: Prisma.TransactionClient) {
    const code = input.dto.code.trim().toUpperCase()
    const config = await transaction.referralConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    if (!config.enabled) throw new BadRequestException("Referrals are currently unavailable")

    const referred = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } })
    if (!referred || referred.status !== "ACTIVE") throw new NotFoundException("Player account not found")
    const referralCode = await transaction.referralCode.findUnique({ where: { code }, select: { id: true, userId: true, inviteCount: true, user: { select: { status: true } } } })
    if (!referralCode || referralCode.user.status !== "ACTIVE") throw new NotFoundException("Referral code not found")
    if (referralCode.userId === input.userId) throw new BadRequestException("You cannot use your own referral code")
    if (referralCode.inviteCount >= config.maxInvitesPerUser) throw new ConflictException("This referral code has reached its invite limit")

    const existing = await transaction.referral.findUnique({ where: { referredId: input.userId }, select: { id: true } })
    if (existing) throw new ConflictException("This account already has a referral attribution")

    await transaction.$queryRaw`SELECT "id" FROM "ReferralCode" WHERE "id" = ${referralCode.id} FOR UPDATE`
    const lockedCode = await transaction.referralCode.findUniqueOrThrow({ where: { id: referralCode.id }, select: { inviteCount: true, userId: true } })
    if (lockedCode.inviteCount >= config.maxInvitesPerUser) throw new ConflictException("This referral code has reached its invite limit")

    const referral = await transaction.referral.create({ data: { referralCodeId: referralCode.id, referrerId: lockedCode.userId, referredId: input.userId } })
    await transaction.referralCode.update({ where: { id: referralCode.id }, data: { inviteCount: { increment: 1 } } })
    const attributionHash = createHash("sha256").update(`${referral.id}:${input.userId}`).digest("hex")
    await transaction.outboxEvent.createMany({ data: [
      { eventType: "referral.joined", aggregateType: "Referral", aggregateId: referral.id, payload: { userId: input.userId, referrerUserId: lockedCode.userId, referralId: referral.id, attributionHash, referralRole: "referred" } as unknown as Prisma.InputJsonValue },
      { eventType: "referral.joined", aggregateType: "Referral", aggregateId: referral.id, payload: { userId: lockedCode.userId, referredUserId: input.userId, referralId: referral.id, attributionHash, referralRole: "referrer" } as unknown as Prisma.InputJsonValue },
    ] })
    return { referralId: referral.id, status: referral.status, code, message: "Referral code applied successfully" }
  }
}
