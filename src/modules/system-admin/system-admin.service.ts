import { Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from "@nestjs/common"
import { Prisma, UserStatus } from "@prisma/client"

import { HashHelper } from "../../common/helpers/hash.helper"
import { PrismaService } from "../../prisma.service"
import { AuthService } from "../auth/services/auth.service"
import { UsersService } from "../admin/access/users/users.service"
import { RegisterRequestDto } from "../auth/dtos/register-request.dto"
import { AdminSessionStatusFilter, RegisterAdminDto, ResetUserPasswordDto, SystemAdminLoginDto, SystemAdminSessionsQueryDto, SystemAdminUsersQueryDto, UpdateUserProfileDto, UpdateUserStatusDto } from "./dtos"
import { DeleteUserTransaction } from "./transactions/delete-user-transaction"
import { EnsureSystemAdminInput, EnsureSystemAdminTransaction } from "./transactions/ensure-system-admin-transaction"
import { ResetUserPasswordTransaction } from "./transactions/reset-user-password-transaction"
import { UpdateUserProfileTransaction } from "./transactions/update-user-profile-transaction"
import { UpdateUserStatusTransaction } from "./transactions/update-user-status-transaction"
import { ProgressionService } from "../progression/progression.service"
import { AwardProgressionPointsDto, CreateProgressionDto, CreateProgressionRewardDto, CreateProgressionTierDto, ResetProgressionDto, UpdateProgressionDto, UpdateProgressionRewardDto, UpdateProgressionTierDto } from "../progression/dtos"
import { CreateCurrencyDto, ReverseWalletDto, UpdateCurrencyDto, WalletMutationDto } from "../economy/dtos"
import { WalletService } from "../economy/wallet.service"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../economy/transactions/debit-wallet-transaction"
import { ReverseWalletTransaction } from "../economy/transactions/reverse-wallet-transaction"
import { ApplyLeaderboardScoreDto, CreateLeaderboardDto, CreateLeaderboardSeasonDto, UpdateLeaderboardDto } from "../leaderboard/dtos"
import { LeaderboardService } from "../leaderboard/leaderboard.service"
import { CreateGameContentDto, UpdateGameConfigDto } from "../game/dtos"
import { GameService } from "../game/game.service"
import { TerminateAdminSessionTransaction } from "./transactions/terminate-admin-session-transaction"
import { CommerceService } from "../commerce/commerce.service"
import { CreateAssetDto, CreateCatalogDto, CreateCatalogItemDto, InventoryMutationDto, InventoryQueryDto, UpdateAssetDto, UpdateCatalogDto, UpdateCatalogItemDto } from "../commerce/dtos"
import { FeedbackQueryDto, SystemAdminStorageQueryDto, UpdateFeedbackDto, UpdatePlayerStorageDto, UploadFileDto } from "../storage/dtos"
import { StorageService } from "../storage/storage.service"
import type { UploadedImage } from "../storage/types"

@Injectable()
export class SystemAdminService implements OnModuleInit {
  private readonly logger = new Logger(SystemAdminService.name)
  private dummyPasswordHash?: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly ensureSystemAdminTransaction: EnsureSystemAdminTransaction,
    private readonly updateUserStatusTransaction: UpdateUserStatusTransaction,
    private readonly deleteUserTransaction: DeleteUserTransaction,
    private readonly updateUserProfileTransaction: UpdateUserProfileTransaction,
    private readonly resetUserPasswordTransaction: ResetUserPasswordTransaction,
    private readonly progressionService: ProgressionService,
    private readonly walletService: WalletService,
    private readonly creditWalletTransaction: CreditWalletTransaction,
    private readonly debitWalletTransaction: DebitWalletTransaction,
    private readonly reverseWalletTransaction: ReverseWalletTransaction,
    private readonly leaderboardService: LeaderboardService,
    private readonly gameService: GameService,
    private readonly terminateAdminSessionTransaction: TerminateAdminSessionTransaction,
    private readonly commerceService: CommerceService,
    private readonly storageService: StorageService,
  ) {}

  async onModuleInit() {
    const username = process.env.SYSTEM_ADMIN_USERNAME?.trim()
    const password = process.env.SYSTEM_ADMIN_PASSWORD
    if (!username && !password) {
      this.logger.warn("System admin bootstrap skipped: SYSTEM_ADMIN_USERNAME and SYSTEM_ADMIN_PASSWORD are not configured")
      return
    }
    if (!username || !password) throw new Error("SYSTEM_ADMIN_USERNAME and SYSTEM_ADMIN_PASSWORD must be configured together")

    const email = this.configuredAdminEmail(username)
    const displayName = process.env.SYSTEM_ADMIN_DISPLAY_NAME?.trim() || "System Administrator"
    const result = await this.ensureSystemAdminTransaction.run({
      username,
      password,
      email,
      displayName,
      countryCode: process.env.SYSTEM_ADMIN_COUNTRY_CODE?.trim(),
      resetPassword: process.env.SYSTEM_ADMIN_RESET_PASSWORD?.trim().toLowerCase() === "true",
    })
    this.logger.log(`System admin bootstrap completed (${result.created ? "created" : "verified"})`)
  }

  async login(dto: SystemAdminLoginDto, request: any) {
    let user = await this.usersService.findByIdentifier(dto.identifier)
    if (!user && this.matchesConfiguredBootstrapCredentials(dto)) {
      await this.ensureSystemAdminTransaction.run(this.getConfiguredBootstrapInput(dto.password))
      user = await this.usersService.findByIdentifier(dto.identifier)
    }
    const passwordHash = user?.passwordHash ?? await this.getDummyPasswordHash()
    const passwordMatches = await HashHelper.compare(dto.password, passwordHash)
    if (!user || !passwordMatches) {
      this.logger.warn(`System admin login rejected (userFound=${Boolean(user)}, passwordMatch=${passwordMatches}, admin=${user?.isSystemAdmin ?? false}, configuredIdentity=${this.matchesConfiguredBootstrapIdentity(dto.identifier)}, configuredPassword=${this.matchesConfiguredBootstrapPassword(dto.password)})`)
      throw new UnauthorizedException("Invalid administrator credentials")
    }
    if (!user.isSystemAdmin) {
      if (!this.matchesConfiguredBootstrapAccount(user.username, user.email, dto.identifier)) {
        throw new UnauthorizedException("Invalid administrator credentials")
      }
      await this.ensureSystemAdminTransaction.run(this.getPromotionInput(user, dto.password))
    }
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException("Administrator account is not active")
    return this.authService.login({ username: user.username, password: dto.password }, request)
  }

  async listUsers(query: SystemAdminUsersQueryDto) {
    const page = query.page || 1
    const limit = query.limit || 25
    const search = query.search?.trim()
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status as UserStatus } : {}),
      ...(search ? {
        OR: [
          { username: { contains: search.toLowerCase(), mode: "insensitive" } },
          { email: { contains: search.toLowerCase(), mode: "insensitive" } },
          { profile: { displayName: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
    }
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          isSystemAdmin: true,
          createdAt: true,
          lastOnline: true,
          profile: { select: { displayName: true, avatarUrl: true, countryCode: true, bio: true, isPublic: true, level: true, xp: true, elo: true } },
          stats: { select: { gamesPlayed: true, wins: true, losses: true, draws: true, currentWinStreak: true, highestWinStreak: true, highestElo: true, totalScore: true } },
          _count: { select: { sessions: true } },
        },
      }),
    ])

    return {
      items: users.map((user) => this.serializeUser(user)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }
  }

  async overview() {
    const [total, active, banned, admins, sessions] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.BANNED } }),
      this.prisma.user.count({ where: { isSystemAdmin: true, status: UserStatus.ACTIVE } }),
      this.prisma.session.count({ where: { sessionStatus: "ACTIVE", expiresAt: { gt: new Date() } } }),
    ])
    return { totalUsers: total, activeUsers: active, bannedUsers: banned, activeAdmins: admins, activeSessions: sessions }
  }

  async createUser(dto: RegisterRequestDto) {
    const user = await this.usersService.create(dto)
    return this.getUser(user.id)
  }

  async createAdmin(dto: RegisterAdminDto) {
    const user = await this.usersService.create({ ...dto, isSystemAdmin: true })
    return this.getUser(user.id)
  }

  async listSessions(query: SystemAdminSessionsQueryDto) {
    const page = query.page || 1
    const limit = query.limit || 50
    const search = query.search?.trim()
    const now = new Date()
    const statusWhere: Prisma.SessionWhereInput = query.status === AdminSessionStatusFilter.Active
      ? { sessionStatus: "ACTIVE", expiresAt: { gt: now } }
      : query.status === AdminSessionStatusFilter.Expired
        ? { sessionStatus: "ACTIVE", expiresAt: { lte: now } }
        : query.status === AdminSessionStatusFilter.Terminated
          ? { sessionStatus: "TERMINATED" }
          : {}
    const where: Prisma.SessionWhereInput = {
      ...statusWhere,
      ...(search ? {
        OR: [
          { user: { username: { contains: search.toLowerCase(), mode: "insensitive" } } },
          { user: { email: { contains: search.toLowerCase(), mode: "insensitive" } } },
          { deviceName: { contains: search, mode: "insensitive" } },
          { deviceInfo: { contains: search, mode: "insensitive" } },
          { ipAddress: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    }
    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.session.count({ where }),
      this.prisma.session.findMany({
        where,
        orderBy: { lastActiveTimestamp: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sessionStatus: true,
          isMobileSession: true,
          clientVersion: true,
          deviceName: true,
          deviceInfo: true,
          ipAddress: true,
          location: true,
          loginTimestamp: true,
          lastActiveTimestamp: true,
          expiresAt: true,
          user: { select: { id: true, username: true, email: true, isSystemAdmin: true, profile: { select: { displayName: true } } } },
        },
      }),
    ])
    return {
      items: sessions.map((session) => ({
        ...session,
        effectiveStatus: session.sessionStatus === "ACTIVE" && session.expiresAt <= now ? "EXPIRED" : session.sessionStatus,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }
  }

  terminateSession(sessionId: string, actorId: string) {
    return this.terminateAdminSessionTransaction.run({ sessionId, actorId })
  }

  getUserDetails(userId: string) {
    return this.getUser(userId, true)
  }

  async getPlayer360(userId: string) {
    const user = await this.getUser(userId, true)
    const [inventory, entitlements, purchases, leaderboardEntries, leaderboardScoreEvents, progressionEvents, rewardGrants, gameStats, matches, storageItems, files, feedback] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, include: { assetDefinition: { select: { id: true, key: true, name: true, assetType: true, ownershipPolicy: true, imageUrl: true } }, assetVariation: { select: { id: true, key: true, name: true, imageUrl: true } } } }),
      this.prisma.entitlement.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, include: { assetDefinition: { select: { key: true, name: true, imageUrl: true } } } }),
      this.prisma.purchase.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { currency: { select: { code: true, name: true } }, lines: { orderBy: { createdAt: "asc" }, include: { catalogItem: { select: { key: true, name: true, imageUrl: true } } } } } }),
      this.prisma.leaderboardEntry.findMany({ where: { playerId: userId }, orderBy: { updatedAt: "desc" }, take: 200, include: { leaderboard: { select: { key: true, name: true, period: true, direction: true } }, season: { select: { id: true, status: true, startsAt: true, endsAt: true } } } }),
      this.prisma.leaderboardScoreEvent.findMany({ where: { playerId: userId }, orderBy: { createdAt: "desc" }, take: 200, include: { leaderboard: { select: { key: true, name: true } }, season: { select: { id: true, status: true } } } }),
      this.prisma.progressionEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { progression: { select: { key: true, name: true, kind: true } } } }),
      this.prisma.rewardGrant.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { currency: { select: { code: true, name: true } }, progressionDefinition: { select: { key: true, name: true } } } }),
      this.prisma.playerGameStats.findMany({ where: { userId }, orderBy: { lastPlayedAt: "desc" }, take: 100, include: { gameDefinition: { select: { key: true, name: true } } } }),
      this.prisma.matchParticipant.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { match: { select: { id: true, mode: true, status: true, startedAt: true, endedAt: true, settledAt: true, createdAt: true, gameDefinition: { select: { key: true, name: true } } } } } }),
      this.prisma.playerStorageItem.findMany({ where: { userId }, orderBy: [{ displayOrder: "asc" }, { key: "asc" }], take: 200 }),
      this.prisma.storedFile.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.prisma.playerFeedback.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, include: { category: { select: { key: true, name: true } } } }),
    ])
    const walletTransactions = user.wallet
      ? await this.prisma.walletTransaction.findMany({ where: { walletId: user.wallet.id }, orderBy: { createdAt: "desc" }, take: 500, include: { currency: { select: { code: true, name: true, kind: true } } } })
      : []
    return this.serialize({ user: { ...user, wallet: user.wallet ? { ...user.wallet, transactions: walletTransactions } : null }, inventory, entitlements, purchases, leaderboardEntries, leaderboardScoreEvents, progressionEvents, rewardGrants, gameStats, matches, storageItems, files, feedback })
  }

  async updateUserProfile(userId: string, actorId: string, dto: UpdateUserProfileDto) {
    await this.updateUserProfileTransaction.run({ userId, actorId, dto })
    return this.getUser(userId, true)
  }

  async resetUserPassword(userId: string, actorId: string, dto: ResetUserPasswordDto) {
    await this.resetUserPasswordTransaction.run({ userId, actorId, password: dto.password })
    return { message: "Password reset and all active sessions terminated" }
  }

  updateStatus(userId: string, actorId: string, dto: UpdateUserStatusDto) {
    return this.updateUserStatusTransaction.run({ userId, actorId, status: dto.status })
  }

  async deleteUser(userId: string, actorId: string) {
    await this.deleteUserTransaction.run({ userId, actorId })
    return { message: "User deleted" }
  }

  listProgressions(includeInactive = false) { return this.progressionService.listDefinitions(includeInactive) }
  getProgression(id: string) { return this.progressionService.getDefinition(id) }
  createProgression(dto: CreateProgressionDto) { return this.progressionService.createDefinition(dto) }
  updateProgression(id: string, dto: UpdateProgressionDto) { return this.progressionService.updateDefinition(id, dto) }
  createProgressionTier(progressionId: string, dto: CreateProgressionTierDto) { return this.progressionService.createTier(progressionId, dto) }
  updateProgressionTier(id: string, dto: UpdateProgressionTierDto) { return this.progressionService.updateTier(id, dto) }
  deleteProgressionTier(id: string) { return this.progressionService.deleteTier(id) }
  createProgressionReward(tierId: string, dto: CreateProgressionRewardDto) { return this.progressionService.createReward(tierId, dto) }
  updateProgressionReward(id: string, dto: UpdateProgressionRewardDto) { return this.progressionService.updateReward(id, dto) }
  deleteProgressionReward(id: string) { return this.progressionService.deleteReward(id) }
  awardProgression(userId: string, key: string, dto: AwardProgressionPointsDto) { return this.progressionService.awardAdmin(userId, key, BigInt(dto.amount), dto.sourceId, dto.metadata) }
  resetProgression(userId: string, key: string, dto: ResetProgressionDto) { return this.progressionService.resetAdmin(userId, key, dto.sourceId) }
  listCurrencies() { return this.walletService.listCurrencies(true) }
  createCurrency(dto: CreateCurrencyDto) { return this.walletService.createCurrency(dto) }
  updateCurrency(id: string, dto: UpdateCurrencyDto) { return this.walletService.updateCurrency(id, dto) }
  getAdminWallet(userId: string) { return this.walletService.getAdminWallet(userId) }
  creditWallet(userId: string, dto: WalletMutationDto, actorId: string) { return this.creditWalletTransaction.run({ userId, currencyCode: dto.currencyCode, amount: BigInt(dto.amount), sourceId: dto.sourceId, sourceType: dto.sourceType ?? "ADMIN", metadata: { ...(dto.metadata ?? {}), actorId } }) }
  debitWallet(userId: string, dto: WalletMutationDto, actorId: string) { return this.debitWalletTransaction.run({ userId, currencyCode: dto.currencyCode, amount: BigInt(dto.amount), sourceId: dto.sourceId, sourceType: dto.sourceType ?? "ADMIN", metadata: { ...(dto.metadata ?? {}), actorId } }) }
  reverseWallet(userId: string, dto: ReverseWalletDto) { return this.reverseWalletTransaction.run({ userId, ledgerId: dto.ledgerId, originalGrantKey: dto.originalGrantKey, sourceId: dto.sourceId }) }
  listLeaderboards(includeInactive = false) { return this.leaderboardService.listDefinitions(includeInactive) }
  createLeaderboard(dto: CreateLeaderboardDto) { return this.leaderboardService.createDefinition(dto) }
  updateLeaderboard(id: string, dto: UpdateLeaderboardDto) { return this.leaderboardService.updateDefinition(id, dto) }
  createLeaderboardSeason(id: string, dto: CreateLeaderboardSeasonDto) { return this.leaderboardService.createSeason(id, dto) }
  closeLeaderboardSeason(id: string) { return this.leaderboardService.closeSeason(id) }
  applyLeaderboardScore(key: string, dto: ApplyLeaderboardScoreDto, actorId: string) { return this.leaderboardService.applyScore({ leaderboardKey: key, playerId: dto.playerId, memberKey: dto.memberKey, delta: BigInt(dto.delta), sourceId: dto.sourceId, sourceType: dto.sourceType ?? "ADMIN", metadata: { ...(dto.metadata ?? {}), actorId } }) }
  topLeaderboardPlayers(key: string, limit: number) { return this.leaderboardService.topForAdmin(key, limit) }
  rebuildLeaderboard(key: string) { return this.leaderboardService.rebuild(key) }
  topProgressionPlayers(key: string, limit: number) { return this.progressionService.topPlayers(key, limit) }
  topCurrencyPlayers(code: string, limit: number) { return this.walletService.topBalances(code, limit) }
  listGameConfigs() { return this.gameService.listAdminDefinitions() }
  updateGameConfig(key: string, dto: UpdateGameConfigDto) { return this.gameService.updateConfig(key, dto) }
  createGameContent(dto: CreateGameContentDto) { return this.gameService.createContent(dto) }
  listGameContent(key: string) { return this.gameService.listContent(key, true) }
  listCommerceCatalogs() { return this.commerceService.listCatalogs(true) }
  createCommerceCatalog(dto: CreateCatalogDto) { return this.commerceService.createCatalog(dto) }
  updateCommerceCatalog(id: string, dto: UpdateCatalogDto) { return this.commerceService.updateCatalog(id, dto) }
  listCommerceAssets() { return this.commerceService.listAssets(true) }
  createCommerceAsset(dto: CreateAssetDto) { return this.commerceService.createAsset(dto) }
  updateCommerceAsset(id: string, dto: UpdateAssetDto) { return this.commerceService.updateAsset(id, dto) }
  createCommerceItem(dto: CreateCatalogItemDto) { return this.commerceService.createCatalogItem(dto) }
  updateCommerceItem(id: string, dto: UpdateCatalogItemDto) { return this.commerceService.updateCatalogItem(id, dto) }
  listCommerceInventory(query: InventoryQueryDto) { return this.commerceService.listInventory(query) }
  listCommercePurchases(userId?: string) { return this.commerceService.listPurchases(userId) }
  grantCommerceInventory(userId: string, dto: InventoryMutationDto, actorId: string) { return this.commerceService.grantInventory(userId, dto, actorId) }
  revokeCommerceInventory(userId: string, dto: InventoryMutationDto, actorId: string) { return this.commerceService.revokeInventory(userId, dto, actorId) }
  playerEntitlements(userId: string) { return this.commerceService.listPlayerEntitlements(userId) }
  uploadFile(file: UploadedImage | undefined, dto: UploadFileDto, actorId: string) { return this.storageService.upload(file, dto, undefined, actorId) }
  listStorage(query: SystemAdminStorageQueryDto) { return this.storageService.listAdminStorage(query) }
  updatePlayerStorage(userId: string, dto: UpdatePlayerStorageDto) { return this.storageService.updateStorage(userId, dto.payload) }
  deletePlayerStorage(userId: string, key: string) { return this.storageService.deleteStorage(userId, key) }
  uploadPlayerFile(file: UploadedImage | undefined, userId: string, dto: UploadFileDto, actorId: string) { return this.storageService.upload(file, dto, userId, actorId) }
  playerFileUrl(fileId: string, userId: string) { return this.storageService.downloadUrl(fileId, userId, true) }
  deletePlayerFile(fileId: string, userId: string) { return this.storageService.delete(fileId, userId, true) }
  fileUrl(fileId: string) { return this.storageService.downloadUrl(fileId, undefined, true) }
  deleteFile(fileId: string) { return this.storageService.delete(fileId, undefined, true) }
  listFeedback(query: FeedbackQueryDto) { return this.storageService.listFeedback(query) }
  updateFeedback(id: string, dto: UpdateFeedbackDto, adminId: string) { return this.storageService.updateFeedback(id, dto, adminId) }

  private async getUser(userId: string, detailed = false) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        isSystemAdmin: true,
        createdAt: true,
        lastOnline: true,
        profile: { select: { displayName: true, avatarUrl: true, countryCode: true, bio: true, isPublic: true, metadata: true, level: true, xp: true, elo: true } },
        stats: { select: { gamesPlayed: true, wins: true, losses: true, draws: true, currentWinStreak: true, highestWinStreak: true, highestElo: true, totalScore: true } },
        _count: { select: { sessions: true } },
        ...(detailed ? {
          wallet: {
            select: {
              id: true,
              status: true,
              balances: {
                select: {
                  id: true,
                  amount: true,
                  currency: { select: { code: true, name: true, kind: true } },
                },
              },
            },
          },
          sessions: {
            orderBy: { lastActiveTimestamp: "desc" },
            take: 100,
            select: {
              id: true,
              sessionStatus: true,
              isMobileSession: true,
              clientVersion: true,
              deviceInfo: true,
              deviceName: true,
              ipAddress: true,
              location: true,
              loginTimestamp: true,
              lastActiveTimestamp: true,
              expiresAt: true,
            },
          },
          progressions: {
            orderBy: { progression: { key: "asc" } },
            take: 100,
            select: {
              id: true,
              points: true,
              step: true,
              previousThreshold: true,
              nextThreshold: true,
              lastLevelUpAt: true,
              progression: { select: { key: true, name: true, kind: true, active: true } },
            },
          },
        } : {}),
      },
    })
    if (!user) throw new NotFoundException("User not found")
    return this.serializeUser(user)
  }

  private serializeUser(user: any) {
    const serialized = {
      ...user,
      profile: user.profile ? { ...user.profile, xp: user.profile.xp.toString() } : null,
      stats: user.stats ? { ...user.stats, totalScore: user.stats.totalScore.toString() } : null,
    }
    if (user.wallet) {
      serialized.wallet = {
        ...user.wallet,
        balances: user.wallet.balances.map((balance: any) => ({
          ...balance,
          amount: balance.amount.toString(),
        })),
      }
    }
    if (user.progressions) {
      serialized.progressions = user.progressions.map((row: any) => ({
        ...row,
        points: row.points.toString(),
        previousThreshold: row.previousThreshold.toString(),
        nextThreshold: row.nextThreshold?.toString() ?? null,
      }))
    }
    return serialized
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T
  }

  private async getDummyPasswordHash() {
    this.dummyPasswordHash ??= await HashHelper.encrypt("constant-time-invalid-password")
    return this.dummyPasswordHash
  }

  private matchesConfiguredBootstrapAccount(username: string, email: string | null, identifier: string) {
    const configuredUsername = process.env.SYSTEM_ADMIN_USERNAME?.trim().toLowerCase()
    const configuredEmail = this.configuredAdminEmail(configuredUsername ?? "").toLowerCase()
    const normalizedIdentifier = identifier.trim().toLowerCase()
    return Boolean(
      process.env.SYSTEM_ADMIN_PASSWORD &&
      (normalizedIdentifier === configuredUsername || normalizedIdentifier === configuredEmail) &&
      (username === configuredUsername || (email && email === configuredEmail)),
    )
  }

  private matchesConfiguredBootstrapCredentials(dto: SystemAdminLoginDto) {
    return this.matchesConfiguredBootstrapIdentity(dto.identifier) && this.matchesConfiguredBootstrapPassword(dto.password)
  }

  private matchesConfiguredBootstrapIdentity(identifier: string) {
    const configuredUsername = process.env.SYSTEM_ADMIN_USERNAME?.trim().toLowerCase()
    const configuredEmail = this.configuredAdminEmail(configuredUsername ?? "").toLowerCase()
    const normalizedIdentifier = identifier.trim().toLowerCase()
    return Boolean(
      configuredUsername &&
      (normalizedIdentifier === configuredUsername || normalizedIdentifier === configuredEmail),
    )
  }

  private matchesConfiguredBootstrapPassword(password: string) {
    return Boolean(process.env.SYSTEM_ADMIN_PASSWORD && password === process.env.SYSTEM_ADMIN_PASSWORD)
  }

  private getConfiguredBootstrapInput(password: string): EnsureSystemAdminInput {
    const username = process.env.SYSTEM_ADMIN_USERNAME!.trim()
    const email = this.configuredAdminEmail(username)
    return {
      username,
      password,
      email,
      displayName: process.env.SYSTEM_ADMIN_DISPLAY_NAME?.trim() || "System Administrator",
      countryCode: process.env.SYSTEM_ADMIN_COUNTRY_CODE?.trim(),
      lookupEmail: email,
    }
  }

  private getPromotionInput(user: { username: string; email: string | null }, password: string): EnsureSystemAdminInput {
    const email = user.email ?? process.env.SYSTEM_ADMIN_EMAIL?.trim() ?? `${user.username}@system-admin.local`
    return {
      username: user.username,
      password,
      email,
      displayName: process.env.SYSTEM_ADMIN_DISPLAY_NAME?.trim() || user.username,
      countryCode: process.env.SYSTEM_ADMIN_COUNTRY_CODE?.trim(),
      lookupEmail: user.email ?? email,
    }
  }

  private configuredAdminEmail(username: string) {
    return process.env.SYSTEM_ADMIN_EMAIL?.trim() || `${username.trim().toLowerCase()}@system-admin.local`
  }
}
