import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateGameContentDto, ImportGameContentDto, UpdateGameConfigDto } from "./dtos"
import { CreateGameContentTransaction } from "./transactions/create-game-content-transaction"
import { UpdateGameConfigTransaction } from "./transactions/update-game-config-transaction"
import { isFastTriviaContent, normalizeTriviaText } from "../matches/utilities/server-content"

@Injectable()
export class GameService {
  constructor(private readonly prisma: PrismaService, private readonly updateConfigTransaction: UpdateGameConfigTransaction, private readonly createContentTransaction: CreateGameContentTransaction) {}

  async listDefinitions(includeInactive = false) {
    const items = await this.prisma.gameDefinition.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 100, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    return this.serialize(items.map((item) => ({ id: item.id, key: item.key, name: item.name, active: item.active, modePolicy: item.modePolicy, config: item.configs[0] ? { version: item.configs[0].version, maxAnswerTimeSeconds: item.configs[0].maxAnswerTimeSeconds, maxMatchDurationSeconds: item.configs[0].maxMatchDurationSeconds, maxQuestions: item.configs[0].maxQuestions, minimumPlayerLevel: item.configs[0].minimumPlayerLevel, rankingEnabled: item.configs[0].rankingEnabled } : null })))
  }

  async listAdminDefinitions() {
    const items = await this.prisma.gameDefinition.findMany({ orderBy: { key: "asc" }, take: 100, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 }, _count: { select: { matches: true, content: true } } } })
    return this.serialize(items.map((item) => ({ ...item, config: item.configs[0] ?? null, configs: undefined })))
  }

  async getDefinition(key: string) {
    const item = await this.prisma.gameDefinition.findUnique({ where: { key: key.trim().toLowerCase() }, include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } })
    if (!item || !item.active) throw new NotFoundException("Game definition not found")
    const config = item.configs[0]
    return this.serialize({ id: item.id, key: item.key, name: item.name, active: item.active, modePolicy: item.modePolicy, config: config ? { version: config.version, maxAnswerTimeSeconds: config.maxAnswerTimeSeconds, maxMatchDurationSeconds: config.maxMatchDurationSeconds, maxQuestions: config.maxQuestions, minimumPlayerLevel: config.minimumPlayerLevel, rankingEnabled: config.rankingEnabled } : null })
  }

  async updateConfig(gameKey: string, dto: UpdateGameConfigDto) {
    const config = await this.updateConfigTransaction.run({ gameKey, dto })
    // Keep the admin write response identical to GET /game-config. The admin
    // form replaces the edited row with this response; returning the raw
    // GameConfig record (with gameDefinition nested) left the row without a
    // key/config shape and made the UI appear to revert after saving.
    const { gameDefinition, ...configFields } = config
    return this.serialize({
      id: gameDefinition.id,
      key: gameDefinition.key,
      name: gameDefinition.name,
      active: gameDefinition.active,
      modePolicy: gameDefinition.modePolicy,
      config: configFields,
    })
  }
  createContent(dto: CreateGameContentDto) { return this.createContentTransaction.run(dto).then((item) => this.serialize(item)) }

  async importContent(dto: ImportGameContentDto) {
    const gameKey = dto.gameKey.trim().toLowerCase()
    const language = dto.language.trim().toLowerCase()
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: gameKey }, select: { id: true, active: true } })
    if (!game || !game.active) throw new NotFoundException("Game definition not found")
    if (!Array.isArray(dto.questions) || dto.questions.length === 0) throw new BadRequestException("The question file contains no questions")

    const parsed = dto.questions.map((value, index) => this.parseImportedQuestion(value, language, index, gameKey)).filter((value): value is NonNullable<typeof value> => value !== null)
    const uniqueParsed = Array.from(new Map(parsed.map((question) => [this.importIdentity(question, gameKey), question])).values())
    if (!uniqueParsed.length) throw new BadRequestException("No valid multiple-choice questions were found")

    return this.prisma.$transaction(async (transaction) => {
      // Serialize imports for one game so two administrators cannot create
      // duplicate active questions at the same time.
      await transaction.$executeRaw`SELECT "id" FROM "GameDefinition" WHERE "id" = ${game.id} FOR UPDATE`
      const existing = await transaction.gameContentItem.findMany({ where: { gameDefinitionId: game.id }, select: { id: true, sourceKey: true, prompt: true, options: true, answerIndex: true, category: true, difficulty: true, active: true } })
      const bySourceKey = new Map(existing.filter((item) => item.sourceKey).map((item) => [item.sourceKey as string, item]))
      let nextVersion = ((await transaction.gameContentItem.findFirst({ where: { gameDefinitionId: game.id }, orderBy: { version: "desc" }, select: { version: true } }))?.version ?? 0) + 1
      let created = 0
      let updated = 0
      let skipped = dto.questions.length - uniqueParsed.length
      const importedItemIds = new Set<string>()
      let removedChallenges = 0

      for (const question of uniqueParsed) {
        let match = bySourceKey.get(question.sourceKey)
        if (!match) {
          match = existing.find((item) => this.sameContent(item, question, language))
        }
        if (match) {
          importedItemIds.add(match.id)
          const prompt = this.mergePrompt(match.prompt, language, question.prompt)
          const currentPrompt = this.promptForLanguage(match.prompt, language)
          if (currentPrompt !== question.prompt || JSON.stringify(match.options) !== JSON.stringify(question.options) || match.answerIndex !== question.answerIndex || match.category !== question.category || match.difficulty !== question.difficulty || match.active !== question.active) {
            await transaction.gameContentItem.update({ where: { id: match.id }, data: { prompt, options: question.options as Prisma.InputJsonValue, answerIndex: question.answerIndex, answerHash: question.answerHash, difficulty: question.difficulty, category: question.category, active: question.active, sourceKey: match.sourceKey ?? question.sourceKey } })
            updated += 1
          } else {
            skipped += 1
          }
          continue
        }

        const createdItem = await transaction.gameContentItem.create({ data: { gameDefinitionId: game.id, version: nextVersion++, contentType: "multiple_choice", sourceKey: question.sourceKey, prompt: { [language]: question.prompt } as Prisma.InputJsonValue, options: question.options as Prisma.InputJsonValue, difficulty: question.difficulty, answerIndex: question.answerIndex, answerHash: question.answerHash, category: question.category, active: question.active }, select: { id: true, sourceKey: true, prompt: true, options: true, answerIndex: true, category: true, difficulty: true, active: true } })
        existing.push(createdItem)
        bySourceKey.set(question.sourceKey, createdItem)
        importedItemIds.add(createdItem.id)
        created += 1
      }

      let removed = 0
      if (gameKey === "trivia") {
        // A challenge with no attempts is only a generated snapshot. Remove
        // it so the next request regenerates it from the newly imported pool.
        // Challenges with attempts remain immutable historical records.
        const deletedChallenges = await transaction.dailyChallenge.deleteMany({ where: { gameDefinitionId: game.id, attempts: { none: {} } } })
        removedChallenges = deletedChallenges.count
        const staleItems = existing.filter((item) => !importedItemIds.has(item.id))
        const staleIds = staleItems.map((item) => item.id)
        if (staleIds.length) {
          // Historical assignments and daily challenges keep a restricted
          // reference to their old content. Delete unreferenced stale rows,
          // and archive referenced rows so history remains readable while no
          // old question can enter a new match.
          const referenced = await transaction.gameContentItem.findMany({
            where: {
              id: { in: staleIds },
              OR: [{ assignments: { some: {} } }, { dailyChallengeQuestions: { some: {} } }],
            },
            select: { id: true },
          })
          const referencedIds = new Set(referenced.map((item) => item.id))
          const deletableIds = staleIds.filter((id) => !referencedIds.has(id))
          if (deletableIds.length) {
            await transaction.gameContentItem.deleteMany({ where: { id: { in: deletableIds } } })
            removed += deletableIds.length
          }
          if (referencedIds.size) {
            const archived = await transaction.gameContentItem.updateMany({ where: { id: { in: [...referencedIds] }, active: true }, data: { active: false } })
            removed += archived.count
          }
        }
      }

      return this.serialize({ gameKey, language, received: dto.questions.length, valid: uniqueParsed.length, created, updated, skipped, replaced: gameKey === "trivia", removed, removedChallenges, activeQuestions: uniqueParsed.filter((question) => question.active).length })
    })
  }

  private parseImportedQuestion(value: unknown, language: string, index: number, gameKey: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    const promptValue = raw.question ?? raw.prompt ?? raw.text
    const prompt = typeof promptValue === "string" ? promptValue.trim() : this.promptForLanguage(promptValue, language)
    const optionsValue = raw.options ?? raw.choices
    const options = Array.isArray(optionsValue) ? optionsValue.map((option) => String(option).trim()).filter(Boolean) : []
    const answerIndexValue = raw.answerIndex ?? raw.correctAnswerIndex
    const answerIndex = typeof answerIndexValue === "number" ? answerIndexValue : Number(answerIndexValue)
    if (!prompt || options.length < 2 || options.length > 8 || !Number.isSafeInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null
    const suppliedKey = raw.sourceKey ?? raw.questionId ?? raw.id
    const identity = typeof suppliedKey === "string" && suppliedKey.trim() ? suppliedKey.trim() : `${prompt}|${options.join("|")}|${answerIndex}`
    const sourceKey = identity.length <= 160 ? identity : `import-${createHash("sha256").update(identity).digest("hex")}`
    const difficultyValue = raw.difficulty ?? 1
    const difficulty = Math.max(1, Math.min(10, Number(difficultyValue) || 1))
    const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : null
    const active = raw.isActive !== false && raw.active !== false
    const parsed = { sourceKey, prompt, options, answerIndex, difficulty, category, active, answerHash: createHash("sha256").update(`${answerIndex}:${JSON.stringify(options)}`).digest("hex"), index }
    // Invalid/slow trivia must not enter the active pool. This also makes
    // admin imports and runtime assignment selection agree on the same rules.
    if (gameKey === "trivia" && !isFastTriviaContent(parsed)) return null
    return parsed
  }

  private promptForLanguage(value: unknown, language: string): string {
    if (typeof value === "string") return value.trim()
    if (!value || typeof value !== "object" || Array.isArray(value)) return ""
    const map = value as Record<string, unknown>
    for (const key of [language, language === "ckb" ? "ku" : "ckb", "en", "ar", "tr"]) {
      if (typeof map[key] === "string" && (map[key] as string).trim()) return (map[key] as string).trim()
    }
    return ""
  }

  private mergePrompt(existing: unknown, language: string, prompt: string): Prisma.InputJsonValue {
    const map = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {}
    map[language] = prompt
    return map as Prisma.InputJsonValue
  }

  private sameContent(existing: { prompt: Prisma.JsonValue; options: Prisma.JsonValue; answerIndex: number; category: string | null }, question: { prompt: string; options: string[]; answerIndex: number; category: string | null }, language: string) {
    return existing.answerIndex === question.answerIndex && existing.category === question.category && this.promptForLanguage(existing.prompt, language).toLowerCase() === question.prompt.toLowerCase() && JSON.stringify(existing.options) === JSON.stringify(question.options)
  }

  private importIdentity(question: { prompt: string; options: string[]; answerIndex: number }, gameKey = "") {
    if (gameKey === "trivia") return `trivia:${normalizeTriviaText(question.prompt)}`
    return createHash("sha256").update(JSON.stringify({ prompt: question.prompt.toLowerCase(), options: question.options, answerIndex: question.answerIndex })).digest("hex")
  }

  async listContent(gameKey: string, includeInactive = false) {
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: gameKey.trim().toLowerCase() }, select: { id: true } })
    if (!game) throw new NotFoundException("Game definition not found")
    const items = await this.prisma.gameContentItem.findMany({ where: { gameDefinitionId: game.id, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 100, select: { id: true, version: true, contentType: true, prompt: true, options: true, difficulty: true, category: true, active: true, createdAt: true } })
    return this.serialize(items)
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T }
}
