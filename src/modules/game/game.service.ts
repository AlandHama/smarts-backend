import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateGameContentDto, UpdateGameConfigDto } from "./dtos"
import { CreateGameContentTransaction } from "./transactions/create-game-content-transaction"
import { UpdateGameConfigTransaction } from "./transactions/update-game-config-transaction"

@Injectable()
export class GameService {
  constructor(private readonly prisma: PrismaService, private readonly updateConfigTransaction: UpdateGameConfigTransaction, private readonly createContentTransaction: CreateGameContentTransaction) {}

  async listDefinitions(includeInactive = false) {
    const items = await this.prisma.gameDefinition.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 100, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    return this.serialize(items.map((item) => ({ id: item.id, key: item.key, name: item.name, active: item.active, modePolicy: item.modePolicy, config: item.configs[0] ? { version: item.configs[0].version, maxAnswerTimeSeconds: item.configs[0].maxAnswerTimeSeconds, maxMatchDurationSeconds: item.configs[0].maxMatchDurationSeconds, maxQuestions: item.configs[0].maxQuestions, rankingEnabled: item.configs[0].rankingEnabled } : null })))
  }

  async listAdminDefinitions() {
    const items = await this.prisma.gameDefinition.findMany({ orderBy: { key: "asc" }, take: 100, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 }, _count: { select: { matches: true, content: true } } } })
    return this.serialize(items.map((item) => ({ ...item, config: item.configs[0] ?? null, configs: undefined })))
  }

  async getDefinition(key: string) {
    const item = await this.prisma.gameDefinition.findUnique({ where: { key: key.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    if (!item || !item.active) throw new NotFoundException("Game definition not found")
    const config = item.configs[0]
    return this.serialize({ id: item.id, key: item.key, name: item.name, active: item.active, modePolicy: item.modePolicy, config: config ? { version: config.version, maxAnswerTimeSeconds: config.maxAnswerTimeSeconds, maxMatchDurationSeconds: config.maxMatchDurationSeconds, maxQuestions: config.maxQuestions, rankingEnabled: config.rankingEnabled } : null })
  }

  updateConfig(gameKey: string, dto: UpdateGameConfigDto) { return this.updateConfigTransaction.run({ gameKey, dto }).then((item) => this.serialize(item)) }
  createContent(dto: CreateGameContentDto) { return this.createContentTransaction.run(dto).then((item) => this.serialize(item)) }

  async listContent(gameKey: string, includeInactive = false) {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: gameKey.trim().toLowerCase() }, select: { id: true } })
    if (!game) throw new NotFoundException("Game definition not found")
    const items = await this.prisma.gameContentItem.findMany({ where: { gameDefinitionId: game.id, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 100, select: { id: true, version: true, contentType: true, prompt: true, options: true, difficulty: true, category: true, active: true, createdAt: true } })
    return this.serialize(items)
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T }
}
