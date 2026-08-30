import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class ResetPlayerProgressionTransaction extends PrismaTransaction<{ userId: string; progressionKey: string; sourceId: string }, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: { userId: string; progressionKey: string; sourceId: string }, transaction: Prisma.TransactionClient) {
    if (!input.sourceId.trim()) throw new BadRequestException("A source id is required")
    const progression = await transaction.progressionDefinition.findUnique({ where: { key: input.progressionKey.trim().toLowerCase() }, include: { tiers: { orderBy: { pointsThreshold: "asc" } } } })
    if (!progression) throw new NotFoundException("Progression definition not found")
    if (progression.resetPolicy === "NEVER") throw new BadRequestException("This progression is not resettable")
    const scope = `progression-reset:${input.userId}:${progression.key}`
    const hash = createHash("sha256").update(`${input.userId}:${progression.key}:${input.sourceId}`).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: input.sourceId.trim() } }, create: { userId: input.userId, scope, key: input.sourceId.trim(), requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new BadRequestException("The source id was already used for another reset")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const row = await transaction.playerProgression.findUnique({ where: { userId_progressionId: { userId: input.userId, progressionId: progression.id } } })
    if (!row) throw new NotFoundException("Player progression not found")
    await transaction.$queryRaw`SELECT "id" FROM "PlayerProgression" WHERE "id" = ${row.id} FOR UPDATE`
    const tier = progression.tiers[0]
    const updated = await transaction.playerProgression.update({ where: { id: row.id }, data: { points: 0n, step: tier.step, previousThreshold: tier.pointsThreshold, nextThreshold: progression.tiers[1]?.pointsThreshold ?? null, lastLevelUpAt: new Date() } })
    await transaction.progressionEvent.create({ data: { userId: input.userId, progressionId: progression.id, playerRowId: row.id, delta: -row.points, balanceBefore: row.points, balanceAfter: 0n, sourceType: "ADMIN", sourceId: input.sourceId.trim(), idempotencyKeyId: idem.id } })
    const result = { progressionKey: progression.key, pointsBefore: row.points.toString(), pointsAfter: "0", step: updated.step }
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return result
  }
}

