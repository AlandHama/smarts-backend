import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { UsersService } from "../admin/access/users/users.service"
import { PlayerResponseDto, PublicPlayerResponseDto, UpdateProfileDto } from "./dtos"
import { AddXpTransaction } from "./transactions/add-xp-transaction"
import { RecordResultTransaction } from "./transactions/record-result-transaction"
import { UpdateEloTransaction } from "./transactions/update-elo-transaction"
import { UpdateProfileTransaction } from "./transactions/update-profile-transaction"

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly updateProfileTransaction: UpdateProfileTransaction,
    private readonly addXpTransaction: AddXpTransaction,
    private readonly updateEloTransaction: UpdateEloTransaction,
    private readonly recordResultTransaction: RecordResultTransaction,
  ) {}

  async findById(userId: string): Promise<PlayerResponseDto> {
    const player = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        profile: true,
        stats: true,
        wallet: {
          select: {
            status: true,
            balances: {
              select: { amount: true, currency: { select: { code: true } } },
              orderBy: { currency: { code: "asc" } },
            },
          },
        },
      },
    })
    if (!player) throw new NotFoundException("Player not found")
    if (!player.profile || !player.stats || !player.wallet) throw new NotFoundException("Player profile is not initialized")
    return this.toCurrentResponse(player)
  }

  async findPublicProfile(userId: string): Promise<PublicPlayerResponseDto> {
    const player = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        profile: true,
        stats: true,
      },
    })
    if (!player) throw new NotFoundException("Player not found")
    if (!player.profile || !player.profile.isPublic || !player.stats) throw new NotFoundException("Player profile is not public")
    return this.toPublicResponse(player)
  }

  async updatePublicProfile(userId: string, dto: UpdateProfileDto): Promise<PlayerResponseDto> {
    await this.updateProfileTransaction.run({ userId, dto })
    return this.findById(userId)
  }

  addXp(userId: string, xp: number | bigint) {
    return this.addXpTransaction.run({ userId, amount: BigInt(xp) })
  }

  updateElo(userId: string, elo: number) {
    return this.updateEloTransaction.run({ userId, elo })
  }

  recordWin(userId: string) {
    return this.recordResultTransaction.run({ userId, result: "win" })
  }

  recordLoss(userId: string) {
    return this.recordResultTransaction.run({ userId, result: "loss" })
  }

  recordDraw(userId: string) {
    return this.recordResultTransaction.run({ userId, result: "draw" })
  }

  updateLastOnline(userId: string) {
    return this.usersService.updateLastOnline(userId)
  }

  private toCurrentResponse(player: {
    id: string
    username: string
    email: string | null
    status: string
    profile: Prisma.UserGetPayload<{ select: { profile: true } }>["profile"]
    stats: Prisma.UserGetPayload<{ select: { stats: true } }>["stats"]
    wallet: {
      status: string
      balances: Array<{ amount: bigint; currency: { code: string } }>
    } | null
  }): PlayerResponseDto {
    if (!player.profile || !player.stats || !player.wallet) throw new NotFoundException("Player profile is not initialized")
    return {
      id: player.id,
      username: player.username,
      email: player.email,
      status: player.status,
      profile: this.toProfileResponse(player.profile),
      stats: this.toStatsResponse(player.stats),
      wallet: {
        status: player.wallet.status,
        balances: player.wallet.balances.map((balance) => ({
          code: balance.currency.code,
          amount: balance.amount.toString(),
        })),
      },
    }
  }

  private toPublicResponse(player: {
    id: string
    username: string
    profile: Prisma.UserGetPayload<{ select: { profile: true } }>["profile"]
    stats: Prisma.UserGetPayload<{ select: { stats: true } }>["stats"]
  }): PublicPlayerResponseDto {
    if (!player.profile || !player.stats) throw new NotFoundException("Player profile is not initialized")
    return {
      id: player.id,
      username: player.username,
      profile: this.toProfileResponse(player.profile),
      stats: {
        gamesPlayed: player.stats.gamesPlayed,
        wins: player.stats.wins,
        losses: player.stats.losses,
        draws: player.stats.draws,
        currentWinStreak: player.stats.currentWinStreak,
        highestWinStreak: player.stats.highestWinStreak,
        highestElo: player.stats.highestElo,
      },
    }
  }

  private toProfileResponse(profile: {
    displayName: string
    avatarUrl: string | null
    countryCode: string | null
    bio: string | null
    level: number
    xp: bigint
    elo: number
  }) {
    return {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      countryCode: profile.countryCode,
      bio: profile.bio,
      level: profile.level,
      xp: profile.xp.toString(),
      elo: profile.elo,
    }
  }

  private toStatsResponse(stats: {
    gamesPlayed: number
    wins: number
    losses: number
    draws: number
    currentWinStreak: number
    highestWinStreak: number
    highestElo: number
    totalScore: bigint
  }) {
    return {
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      currentWinStreak: stats.currentWinStreak,
      highestWinStreak: stats.highestWinStreak,
      highestElo: stats.highestElo,
      totalScore: stats.totalScore.toString(),
    }
  }
}
