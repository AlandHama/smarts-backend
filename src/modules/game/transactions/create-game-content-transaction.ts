import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateGameContentDto } from "../dtos"

@Injectable()
export class CreateGameContentTransaction extends PrismaTransaction<CreateGameContentDto, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: CreateGameContentDto, transaction: Prisma.TransactionClient) {
    const game = await transaction.gameDefinition.findUnique({ where: { key: input.gameKey.trim().toLowerCase() }, select: { id: true } })
    if (!game) throw new NotFoundException("Game definition not found")
    const options = input.options as unknown[]
    if (!Array.isArray(options) || options.length < 2 || input.answerIndex >= options.length) throw new BadRequestException("Content options and answer index are invalid")
    const answerHash = createHash("sha256").update(`${input.answerIndex}:${JSON.stringify(options)}`).digest("hex")
    const latest = await transaction.gameContentItem.findFirst({ where: { gameDefinitionId: game.id }, orderBy: { version: "desc" }, select: { version: true } })
    return transaction.gameContentItem.create({ data: { gameDefinitionId: game.id, version: (latest?.version ?? 0) + 1, contentType: input.contentType.trim(), prompt: input.prompt as Prisma.InputJsonValue, options: options as Prisma.InputJsonValue, difficulty: input.difficulty, answerIndex: input.answerIndex, answerHash, category: input.category?.trim() || undefined }, select: { id: true, version: true, contentType: true, prompt: true, options: true, difficulty: true, category: true, active: true, createdAt: true } })
  }
}
