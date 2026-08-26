import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateUserInput } from "../../admin/access/users/transactions/create-user-transaction"

export type EnsureSystemAdminInput = CreateUserInput & { lookupEmail?: string }

@Injectable()
export class EnsureSystemAdminTransaction extends PrismaTransaction<EnsureSystemAdminInput, { created: boolean }> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(dto: EnsureSystemAdminInput, transaction: Prisma.TransactionClient) {
    const username = dto.username.trim().toLowerCase()
    const lookupEmail = (dto.lookupEmail ?? dto.email).trim().toLowerCase()
    const existing = await transaction.user.findFirst({
      where: { OR: [{ username }, { email: lookupEmail }] },
      select: { id: true, isSystemAdmin: true },
    })
    if (existing) {
      if (!existing.isSystemAdmin) {
        await transaction.user.update({ where: { id: existing.id }, data: { isSystemAdmin: true } })
      }
      return { created: false }
    }

    await transaction.user.create({
      data: {
        username,
        passwordHash: await HashHelper.encrypt(dto.password),
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
        email: dto.email.trim().toLowerCase(),
        isSystemAdmin: true,
        profile: {
          create: {
            displayName: dto.displayName.trim(),
            countryCode: dto.countryCode?.trim().toUpperCase(),
            level: 1,
            xp: 0n,
            elo: 1000,
          },
        },
        stats: {
          create: {
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            currentWinStreak: 0,
            highestWinStreak: 0,
            highestElo: 1000,
            totalScore: 0n,
          },
        },
      },
    })
    return { created: true }
  }
}
