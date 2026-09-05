import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateUserProfileDto } from "../dtos/update-user-profile.dto"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export interface UpdateUserProfileInput {
  userId: string
  actorId: string
  dto: UpdateUserProfileDto
}

@Injectable()
export class UpdateUserProfileTransaction extends PrismaTransaction<UpdateUserProfileInput, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: UpdateUserProfileInput, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({
      where: { id: data.userId },
      select: { id: true, username: true, email: true, firstName: true, lastName: true, profile: true },
    })
    if (!user || !user.profile) throw new NotFoundException("User profile not found")

    const dto = data.dto
    const username = dto.username?.trim().toLowerCase()
    const email = dto.email === undefined || dto.email === null ? dto.email : dto.email.trim().toLowerCase()

    try {
      if (username !== undefined || email !== undefined || dto.firstName !== undefined || dto.lastName !== undefined) {
        await transaction.user.update({
          where: { id: data.userId },
          data: {
            ...(username !== undefined ? { username } : {}),
            ...(email !== undefined ? { email } : {}),
            ...(dto.firstName !== undefined ? { firstName: dto.firstName?.trim() || null } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName?.trim() || null } : {}),
          },
        })
      }

    const profileData: Prisma.PlayerProfileUpdateInput = {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode?.trim().toUpperCase() || null } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio?.trim() || null } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
      }
      if (Object.keys(profileData).length > 0) {
        await transaction.playerProfile.update({ where: { userId: data.userId }, data: profileData })
      }
      await writeAdminAudit(transaction, { actorId: data.actorId, action: "USER_PROFILE_UPDATE", entityType: "User", entityId: data.userId, reason: dto.reason, metadata: { fields: Object.keys({ ...dto }).filter((field) => field !== "password") } })
      const fields = Object.keys({ ...dto }).filter((field) => field !== "password" && field !== "reason")
      const changes: Record<string, { old: unknown; new: unknown }> = {}
      if (username !== undefined) changes.username = { old: user.username, new: username }
      if (email !== undefined) changes.email = { old: user.email, new: email }
      if (dto.displayName !== undefined) changes.displayName = { old: user.profile.displayName, new: dto.displayName.trim() }
      if (dto.avatarUrl !== undefined) changes.avatarUrl = { old: user.profile.avatarUrl, new: dto.avatarUrl }
      if (dto.countryCode !== undefined) changes.countryCode = { old: user.profile.countryCode, new: dto.countryCode?.trim().toUpperCase() || null }
      if (dto.bio !== undefined) changes.bio = { old: user.profile.bio, new: dto.bio?.trim() || null }
      if (dto.firstName !== undefined) changes.firstName = { old: user.firstName, new: dto.firstName?.trim() || null }
      if (dto.lastName !== undefined) changes.lastName = { old: user.lastName, new: dto.lastName?.trim() || null }
      if (dto.isPublic !== undefined) changes.isPublic = { old: user.profile.isPublic, new: dto.isPublic }
      if (fields.length) await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.ADMIN, action: "PROFILE_UPDATED_BY_ADMIN", entityType: "User", entityId: data.userId, summary: `Administrator updated player profile: ${fields.join(", ")}`, changes, metadata: { fields, actorId: data.actorId } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Username or email is already registered")
      }
      throw error
    }
  }
}
