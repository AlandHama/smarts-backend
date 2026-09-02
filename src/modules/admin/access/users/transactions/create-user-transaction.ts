import { ConflictException, Injectable, InternalServerErrorException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { RegisterRequestDto } from "../../../../auth/dtos/register-request.dto"
import { CreditWalletTransaction } from "../../../../economy/transactions/credit-wallet-transaction"
import { writeAdminAudit } from "../../../../../common/helpers/admin-audit"

export type CreateUserInput = RegisterRequestDto & { isSystemAdmin?: boolean; actorId?: string; reason?: string }

@Injectable()
export class CreateUserTransaction extends PrismaTransaction<CreateUserInput, any> {
  constructor(prisma: PrismaService, private readonly creditWalletTransaction: CreditWalletTransaction) {
    super(prisma)
  }

  protected async execute(dto: CreateUserInput, transaction: Prisma.TransactionClient) {
    try {
      const currencies = await transaction.currencyDefinition.findMany({
        where: { code: { in: ["MCN", "GLD"] }, active: true },
        select: { id: true, code: true },
      })
      const currencyIds = new Map(currencies.map((currency) => [currency.code, currency.id]))
      if (!currencyIds.has("MCN") || !currencyIds.has("GLD")) {
        throw new InternalServerErrorException("Default currencies are not configured")
      }
      const progressions = await transaction.progressionDefinition.findMany({
        where: { active: true },
        select: {
          id: true,
          tiers: {
            orderBy: { step: "asc" },
            take: 2,
            select: { step: true, pointsThreshold: true },
          },
        },
      })
      const incompleteProgression = progressions.find((progression) => !progression.tiers.length)
      if (incompleteProgression) throw new InternalServerErrorException("An active progression has no tiers configured")

      const user = await transaction.user.create({
        data: {
          username: dto.username.trim().toLowerCase(),
          passwordHash: await HashHelper.encrypt(dto.password),
          firstName: dto.firstName?.trim() || null,
          lastName: dto.lastName?.trim() || null,
          email: dto.email.trim().toLowerCase(),
          isSystemAdmin: dto.isSystemAdmin ?? false,
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
          wallet: {
            create: {
              walletType: "PLAYER",
              status: "ACTIVE",
              balances: {
                create: [
                  { currencyId: currencyIds.get("MCN")!, amount: 0n },
                  { currencyId: currencyIds.get("GLD")!, amount: 0n },
                ],
              },
            },
          },
          progressions: {
            create: progressions.map((progression) => ({
              progressionId: progression.id,
              points: 0n,
              step: progression.tiers[0].step,
              previousThreshold: progression.tiers[0].pointsThreshold,
              nextThreshold: progression.tiers[1]?.pointsThreshold ?? null,
            })),
          },
        },
      })
      const signupAmountText = process.env.SIGNUP_MCN_AMOUNT?.trim() || "1500"
      if (!/^\d+$/.test(signupAmountText)) throw new InternalServerErrorException("SIGNUP_MCN_AMOUNT must be a non-negative integer")
      const signupAmount = BigInt(signupAmountText)
      if (signupAmount > 0n) {
        await this.creditWalletTransaction.runWithinTransaction({
          userId: user.id,
          currencyCode: "MCN",
          amount: signupAmount,
          sourceId: `signup:${user.id}`,
          sourceType: "SIGNUP",
        }, transaction)
      }
      if (dto.actorId) await writeAdminAudit(transaction, { actorId: dto.actorId, action: dto.isSystemAdmin ? "ADMIN_CREATE" : "USER_CREATE", entityType: "User", entityId: user.id, reason: dto.reason, metadata: { isSystemAdmin: dto.isSystemAdmin ?? false } })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Username or email is already registered")
      }
      throw error
    }
  }
}
