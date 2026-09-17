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

  async gameStats(userId: string) {
    const stats = await this.prisma.playerGameStats.findMany({
      where: { userId },
      orderBy: { gameDefinition: { key: "asc" } },
      select: {
        gamesPlayed: true,
        wins: true,
        losses: true,
        draws: true,
        forfeits: true,
        totalCorrect: true,
        totalQuestions: true,
        totalTimeMs: true,
        totalScore: true,
        bestScore: true,
        lastPlayedAt: true,
        gameDefinition: { select: { key: true, name: true } },
      },
    })
    return stats.map((stat) => ({
      gameKey: stat.gameDefinition.key,
      gameName: stat.gameDefinition.name,
      gamesPlayed: stat.gamesPlayed,
      wins: stat.wins,
      losses: stat.losses,
      draws: stat.draws,
      forfeits: stat.forfeits,
      totalCorrect: stat.totalCorrect,
      totalQuestions: stat.totalQuestions,
      totalTimeMs: stat.totalTimeMs.toString(),
      totalScore: stat.totalScore.toString(),
      bestScore: stat.bestScore.toString(),
      lastPlayedAt: stat.lastPlayedAt,
    }))
  }

  async publicOverview(viewerId: string, playerId: string) {
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        username: true,
        profile: true,
        stats: true,
        gameStats: {
          orderBy: { gameDefinition: { key: "asc" } },
          select: {
            gamesPlayed: true,
            wins: true,
            losses: true,
            draws: true,
            forfeits: true,
            totalCorrect: true,
            totalQuestions: true,
            totalTimeMs: true,
            totalScore: true,
            bestScore: true,
            lastPlayedAt: true,
            gameDefinition: { select: { key: true, name: true } },
          },
        },
      },
    })
    if (!player || !player.profile?.isPublic || !player.stats) throw new NotFoundException("Player not found")

    if (viewerId !== playerId) {
      const friendship = await this.prisma.friendship.findUnique({
        where: { userId_friendId: { userId: viewerId, friendId: playerId } },
        select: { id: true },
      })
      if (!friendship) throw new NotFoundException("Player overview not found")
    }

    const matches = viewerId === playerId ? [] : await this.prisma.match.findMany({
      where: {
        status: "SETTLED",
        AND: [
          { participants: { some: { userId: viewerId } } },
          { participants: { some: { userId: playerId } } },
        ],
      },
      orderBy: { endedAt: "desc" },
      take: 100,
      select: {
        endedAt: true,
        gameDefinition: { select: { key: true, name: true } },
        participants: {
          where: { userId: { in: [viewerId, playerId] } },
          select: { userId: true, finalScore: true, result: true },
        },
      },
    })

    let wins = 0
    let losses = 0
    let draws = 0
    let yourScore = 0
    let opponentScore = 0
    const byGame = new Map<string, { gameKey: string; gameName: string; matches: number; wins: number; losses: number; draws: number; yourScore: number; opponentScore: number }>()

    for (const match of matches) {
      const you = match.participants.find((participant) => participant.userId === viewerId)
      const opponent = match.participants.find((participant) => participant.userId === playerId)
      if (!you || !opponent) continue
      const youScore = you.finalScore ?? 0
      const opponentFinalScore = opponent.finalScore ?? 0
      yourScore += youScore
      opponentScore += opponentFinalScore
      const result = you.result === "WIN" ? "WIN" : you.result === "LOSS" ? "LOSS" : "DRAW"
      if (result === "WIN") wins += 1
      else if (result === "LOSS") losses += 1
      else draws += 1

      const key = match.gameDefinition.key
      const game = byGame.get(key) ?? { gameKey: key, gameName: match.gameDefinition.name, matches: 0, wins: 0, losses: 0, draws: 0, yourScore: 0, opponentScore: 0 }
      game.matches += 1
      game.yourScore += youScore
      game.opponentScore += opponentFinalScore
      if (result === "WIN") game.wins += 1
      else if (result === "LOSS") game.losses += 1
      else game.draws += 1
      byGame.set(key, game)
    }

    return {
      ...this.toPublicResponse(player),
      gameStats: player.gameStats.map((stat) => ({
        gameKey: stat.gameDefinition.key,
        gameName: stat.gameDefinition.name,
        gamesPlayed: stat.gamesPlayed,
        wins: stat.wins,
        losses: stat.losses,
        draws: stat.draws,
        forfeits: stat.forfeits,
        totalCorrect: stat.totalCorrect,
        totalQuestions: stat.totalQuestions,
        totalTimeMs: stat.totalTimeMs.toString(),
        totalScore: stat.totalScore.toString(),
        bestScore: stat.bestScore.toString(),
        lastPlayedAt: stat.lastPlayedAt,
      })),
      headToHead: {
        matchesPlayed: matches.length,
        wins,
        losses,
        draws,
        yourScore: yourScore.toString(),
        opponentScore: opponentScore.toString(),
        lastPlayedAt: matches[0]?.endedAt ?? null,
        games: [...byGame.values()],
      },
    }
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
        totalScore: player.stats.totalScore.toString(),
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
