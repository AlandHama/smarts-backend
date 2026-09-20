import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateRankingConfigDto, UpdateRankingConfigDto } from "./dtos"

@Injectable()
export class RankingService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Keep first deployment useful even when the migration was applied to an
    // already-running database without the optional seed rows.
    const count = await this.prisma.rankingMatchConfig.count()
    if (count) return
    await this.prisma.rankingMatchConfig.createMany({ data: [
      { key: "ranked-5", name: "5 GLD Arena", stakeAmountGld: 5n, entryFeeGld: 1n, sortOrder: 10 },
      { key: "ranked-10", name: "10 GLD Arena", stakeAmountGld: 10n, entryFeeGld: 2n, sortOrder: 20 },
      { key: "ranked-15", name: "15 GLD Arena", stakeAmountGld: 15n, entryFeeGld: 3n, sortOrder: 30 },
    ] })
  }

  async listConfigs(includeDisabled = false) {
    return this.serialize(await this.prisma.rankingMatchConfig.findMany({ where: includeDisabled ? undefined : { enabled: true }, orderBy: [{ sortOrder: "asc" }, { stakeAmountGld: "asc" }] }))
  }

  async createConfig(dto: CreateRankingConfigDto) {
    const name = dto.name.trim()
    const stake = BigInt(dto.stakeAmountGld)
    const fee = BigInt(dto.entryFeeGld)
    if (!name) throw new BadRequestException("Arena name is required")
    if (fee >= stake) throw new BadRequestException("Entry fee must be lower than the stake")

    const baseKey = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "arena"
    let key = baseKey
    let suffix = 2
    while (await this.prisma.rankingMatchConfig.findUnique({ where: { key } })) {
      key = `${baseKey.slice(0, 64 - String(suffix).length - 1)}-${suffix}`
      suffix += 1
    }

    const created = await this.prisma.rankingMatchConfig.create({ data: {
      key,
      name,
      stakeAmountGld: stake,
      entryFeeGld: fee,
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    } })
    return this.serialize(created)
  }

  async updateConfig(id: string, dto: UpdateRankingConfigDto) {
    const current = await this.prisma.rankingMatchConfig.findUnique({ where: { id } })
    if (!current) throw new NotFoundException("Ranking entry tier not found")
    const stake = dto.stakeAmountGld === undefined ? current.stakeAmountGld : BigInt(dto.stakeAmountGld)
    const fee = dto.entryFeeGld === undefined ? current.entryFeeGld : BigInt(dto.entryFeeGld)
    if (stake <= 0n || fee < 0n || fee >= stake) throw new BadRequestException("Entry fee must be lower than the stake")
    return this.serialize(await this.prisma.rankingMatchConfig.update({ where: { id }, data: { name: dto.name?.trim() || undefined, stakeAmountGld: stake, entryFeeGld: fee, enabled: dto.enabled, sortOrder: dto.sortOrder } }))
  }

  async deleteConfig(id: string) {
    const current = await this.prisma.rankingMatchConfig.findUnique({ where: { id } })
    if (!current) throw new NotFoundException("Ranking entry tier not found")
    const [ticketCount, matchCount] = await Promise.all([
      this.prisma.matchmakingTicket.count({ where: { rankingConfigId: id } }),
      this.prisma.rankingMatch.count({ where: { configId: id } }),
    ])
    if (ticketCount || matchCount) throw new ConflictException("Arena has match history or active tickets; disable it instead")
    return this.serialize(await this.prisma.rankingMatchConfig.delete({ where: { id } }))
  }

  async history(limit = 100) {
    const rows = await this.prisma.rankingMatch.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        config: { select: { key: true, name: true } },
        match: { select: { id: true, status: true, mode: true, createdAt: true, settledAt: true, gameDefinition: { select: { key: true, name: true } }, participants: { select: { userId: true, participantType: true, finalScore: true, result: true, user: { select: { username: true, profile: { select: { displayName: true } } } } } } } },
        winner: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
    })
    return this.serialize(rows)
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T
  }
}
