import { Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateProfileDto } from "../dtos/update-profile.dto"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

@Injectable()
export class UpdateProfileTransaction extends PrismaTransaction<{ userId: string; dto: UpdateProfileDto }, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: { userId: string; dto: UpdateProfileDto }, transaction: Prisma.TransactionClient) {
    const profile = await transaction.playerProfile.findUnique({ where: { userId: data.userId } })
    if (!profile) throw new NotFoundException("Player profile not found")

    const dto = data.dto
    const profileData: Prisma.PlayerProfileUpdateInput = {}
    if (dto.displayName !== undefined) profileData.displayName = dto.displayName.trim()
    if (dto.avatarUrl !== undefined) profileData.avatarUrl = dto.avatarUrl
    if (dto.countryCode !== undefined) profileData.countryCode = dto.countryCode?.trim().toUpperCase() ?? null
    if (dto.bio !== undefined) profileData.bio = dto.bio?.trim() || null
    if (dto.isPublic !== undefined) profileData.isPublic = dto.isPublic

    if (Object.keys(profileData).length > 0) {
      await transaction.playerProfile.update({ where: { userId: data.userId }, data: profileData })
    }
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      await transaction.user.update({
        where: { id: data.userId },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName?.trim() || null } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName?.trim() || null } : {}),
        },
      })
    }
    const fields = Object.keys(dto).filter((field) => field !== "password")
    if (fields.length) await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.PLAYER, action: "PROFILE_UPDATED", entityType: "User", entityId: data.userId, summary: `Updated player profile: ${fields.join(", ")}`, metadata: { fields } })
  }
}
