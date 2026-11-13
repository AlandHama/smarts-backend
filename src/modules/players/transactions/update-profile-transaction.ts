import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { UpdateProfileDto } from "../dtos/update-profile.dto"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { ContentSafetyService } from "../../content-safety/content-safety.service"
import { normalizeCountryCode } from "../country-code"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { applyGldPolicyOverrides, getGldConfig } from "../../gld/gld.config"

@Injectable()
export class UpdateProfileTransaction extends PrismaTransaction<{ userId: string; dto: UpdateProfileDto }, void> {
  constructor(
    prisma: PrismaService,
    private readonly contentSafety: ContentSafetyService,
    private readonly debitWallet: DebitWalletTransaction,
  ) {
    super(prisma)
  }

  protected async execute(data: { userId: string; dto: UpdateProfileDto }, transaction: Prisma.TransactionClient) {
    const current = await transaction.user.findUnique({ where: { id: data.userId }, select: { username: true, firstName: true, lastName: true, profile: true } })
    const profile = current?.profile
    if (!profile) throw new NotFoundException("Player profile not found")

    const dto = data.dto
    this.contentSafety.assertSafeText(dto.displayName, "Display name")
    this.contentSafety.assertSafeText(dto.username, "Username")
    this.contentSafety.assertSafeText(dto.firstName, "First name")
    this.contentSafety.assertSafeText(dto.lastName, "Last name")
    this.contentSafety.assertSafeText(dto.bio, "Bio")
    const nextDisplayName = dto.displayName === undefined ? profile.displayName : dto.displayName.trim()
    const nextUsername = dto.username === undefined ? current.username : dto.username.trim().toLowerCase()
    const nextCountryCode = dto.countryCode === undefined ? profile.countryCode : normalizeCountryCode(dto.countryCode)
    const displayNameChanged = dto.displayName !== undefined && nextDisplayName !== profile.displayName
    const usernameChanged = dto.username !== undefined && nextUsername !== current.username
    const countryChanged = dto.countryCode !== undefined && nextCountryCode !== profile.countryCode
    if (usernameChanged) {
      const existing = await transaction.user.findUnique({ where: { username: nextUsername }, select: { id: true } })
      if (existing && existing.id !== data.userId) throw new ConflictException("Username is already taken")
    }

    const profileData: Prisma.PlayerProfileUpdateInput = {}
    if (displayNameChanged) profileData.displayName = nextDisplayName
    if (dto.avatarUrl !== undefined) profileData.avatarUrl = dto.avatarUrl
    if (dto.avatarFrameKey !== undefined) profileData.avatarFrameKey = dto.avatarFrameKey?.trim() || null
    if (dto.countryCode !== undefined) profileData.countryCode = nextCountryCode
    if (dto.bio !== undefined) profileData.bio = dto.bio?.trim() || null
    if (dto.isPublic !== undefined) profileData.isPublic = dto.isPublic
    if (usernameChanged) profileData.usernameChangeCount = { increment: 1 }
    if (displayNameChanged) profileData.displayNameChangeCount = { increment: 1 }
    if (countryChanged) profileData.countryChangeCount = { increment: 1 }

    const controls = await transaction.gldAdminControl.findUnique({ where: { singletonKey: "default" } })
    const gldConfig = applyGldPolicyOverrides(getGldConfig(), controls)
    const usernameCost = usernameChanged && profile.usernameChangeCount > 0 ? gldConfig.usernameChangeCostGld : 0n
    const displayNameCost = displayNameChanged && profile.displayNameChangeCount > 0 ? gldConfig.displayNameChangeCostGld : 0n
    const countryCost = countryChanged && profile.countryChangeCount > 0 ? gldConfig.countryChangeCostGld : 0n
    const totalProfileChangeCost = usernameCost + displayNameCost + countryCost
    if (totalProfileChangeCost > 0n) {
      const sourceId = `profile-change:${data.userId}:u${profile.usernameChangeCount}:d${profile.displayNameChangeCount}:c${profile.countryChangeCount}`
      await this.debitWallet.runWithinTransaction({
        userId: data.userId,
        currencyCode: "GLD",
        amount: totalProfileChangeCost,
        sourceId,
        sourceType: WalletTransactionSourceType.SYSTEM,
        metadata: {
          reason: "PROFILE_CHANGE",
          usernameChanged,
          displayNameChanged,
          usernameCost: usernameCost.toString(),
          displayNameCost: displayNameCost.toString(),
          countryChanged,
          countryCost: countryCost.toString(),
        },
      }, transaction)
    }

    if (Object.keys(profileData).length > 0) {
      await transaction.playerProfile.update({ where: { userId: data.userId }, data: profileData })
    }
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      await transaction.user.update({
        where: { id: data.userId },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName?.trim() || null } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName?.trim() || null } : {}),
          ...(usernameChanged ? { username: nextUsername } : {}),
        },
      })
    }
    const fields = Object.keys(dto).filter((field) => field !== "password")
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    if (displayNameChanged) changes.displayName = { old: profile.displayName, new: nextDisplayName }
    if (usernameChanged) changes.username = { old: current.username, new: nextUsername }
    if (dto.avatarUrl !== undefined) changes.avatarUrl = { old: profile.avatarUrl, new: dto.avatarUrl }
    if (dto.avatarFrameKey !== undefined) changes.avatarFrameKey = { old: profile.avatarFrameKey, new: dto.avatarFrameKey?.trim() || null }
    if (dto.countryCode !== undefined) changes.countryCode = { old: profile.countryCode, new: nextCountryCode }
    if (dto.bio !== undefined) changes.bio = { old: profile.bio, new: dto.bio?.trim() || null }
    if (dto.isPublic !== undefined) changes.isPublic = { old: profile.isPublic, new: dto.isPublic }
    if (dto.firstName !== undefined) changes.firstName = { old: current?.firstName, new: dto.firstName?.trim() || null }
    if (dto.lastName !== undefined) changes.lastName = { old: current?.lastName, new: dto.lastName?.trim() || null }
    if (fields.length) await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.PLAYER, action: "PROFILE_UPDATED", entityType: "User", entityId: data.userId, summary: `Updated player profile: ${fields.join(", ")}`, changes, metadata: { fields, profileChangeCostGld: totalProfileChangeCost.toString(), countryChangeCostGld: countryCost.toString(), countryChangeWasFree: countryChanged && profile.countryChangeCount === 0 } })
  }
}
