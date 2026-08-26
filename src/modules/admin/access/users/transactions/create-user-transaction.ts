import { ConflictException, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { RegisterRequestDto } from "../../../../auth/dtos/register-request.dto"

export type CreateUserInput = RegisterRequestDto & { isSystemAdmin?: boolean }

@Injectable()
export class CreateUserTransaction extends PrismaTransaction<CreateUserInput, any> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(dto: CreateUserInput, transaction: Prisma.TransactionClient) {
    try {
      return await transaction.user.create({
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
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Username or email is already registered")
      }
      throw error
    }
  }
}
