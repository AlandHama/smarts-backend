import { Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from "@nestjs/common"
import { Prisma, UserStatus } from "@prisma/client"

import { HashHelper } from "../../common/helpers/hash.helper"
import { PrismaService } from "../../prisma.service"
import { AuthService } from "../auth/services/auth.service"
import { UsersService } from "../admin/access/users/users.service"
import { RegisterRequestDto } from "../auth/dtos/register-request.dto"
import { SystemAdminLoginDto, SystemAdminUsersQueryDto, UpdateUserStatusDto } from "./dtos"
import { DeleteUserTransaction } from "./transactions/delete-user-transaction"
import { EnsureSystemAdminInput, EnsureSystemAdminTransaction } from "./transactions/ensure-system-admin-transaction"
import { UpdateUserStatusTransaction } from "./transactions/update-user-status-transaction"

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
  ) {}

  async onModuleInit() {
    const username = process.env.SYSTEM_ADMIN_USERNAME?.trim()
    const password = process.env.SYSTEM_ADMIN_PASSWORD
    if (!username && !password) {
      this.logger.warn("System admin bootstrap skipped: SYSTEM_ADMIN_USERNAME and SYSTEM_ADMIN_PASSWORD are not configured")
      return
    }
    if (!username || !password) throw new Error("SYSTEM_ADMIN_USERNAME and SYSTEM_ADMIN_PASSWORD must be configured together")

    const email = process.env.SYSTEM_ADMIN_EMAIL?.trim() || `${username.toLowerCase()}@system-admin.local`
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
          profile: { select: { displayName: true, avatarUrl: true, level: true, xp: true, elo: true } },
          stats: { select: { gamesPlayed: true, wins: true, losses: true, draws: true, totalScore: true } },
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

  updateStatus(userId: string, actorId: string, dto: UpdateUserStatusDto) {
    return this.updateUserStatusTransaction.run({ userId, actorId, status: dto.status })
  }

  async deleteUser(userId: string, actorId: string) {
    await this.deleteUserTransaction.run({ userId, actorId })
    return { message: "User deleted" }
  }

  private async getUser(userId: string) {
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
        profile: { select: { displayName: true, avatarUrl: true, level: true, xp: true, elo: true } },
        stats: { select: { gamesPlayed: true, wins: true, losses: true, draws: true, totalScore: true } },
        _count: { select: { sessions: true } },
      },
    })
    if (!user) throw new NotFoundException("User not found")
    return this.serializeUser(user)
  }

  private serializeUser(user: any) {
    return {
      ...user,
      profile: user.profile ? { ...user.profile, xp: user.profile.xp.toString() } : null,
      stats: user.stats ? { ...user.stats, totalScore: user.stats.totalScore.toString() } : null,
    }
  }

  private async getDummyPasswordHash() {
    this.dummyPasswordHash ??= await HashHelper.encrypt("constant-time-invalid-password")
    return this.dummyPasswordHash
  }

  private matchesConfiguredBootstrapAccount(username: string, email: string | null, identifier: string) {
    const configuredUsername = process.env.SYSTEM_ADMIN_USERNAME?.trim().toLowerCase()
    const configuredEmail = process.env.SYSTEM_ADMIN_EMAIL?.trim().toLowerCase()
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
    const configuredEmail = process.env.SYSTEM_ADMIN_EMAIL?.trim().toLowerCase()
    const normalizedIdentifier = identifier.trim().toLowerCase()
    return Boolean(
      configuredUsername &&
      configuredEmail &&
      (normalizedIdentifier === configuredUsername || normalizedIdentifier === configuredEmail),
    )
  }

  private matchesConfiguredBootstrapPassword(password: string) {
    return Boolean(process.env.SYSTEM_ADMIN_PASSWORD && password === process.env.SYSTEM_ADMIN_PASSWORD)
  }

  private getConfiguredBootstrapInput(password: string): EnsureSystemAdminInput {
    const username = process.env.SYSTEM_ADMIN_USERNAME!.trim()
    const email = process.env.SYSTEM_ADMIN_EMAIL!.trim()
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
}
