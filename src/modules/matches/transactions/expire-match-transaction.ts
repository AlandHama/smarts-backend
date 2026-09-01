import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

@Injectable()
export class ExpireMatchTransaction extends PrismaTransaction<void, { expired: number }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const now = new Date()
    const matches = await transaction.match.findMany({ where: { status: { in: ["CREATED", "STARTED"] }, OR: [{ createdAt: { lte: now } }] }, include: { gameConfig: { select: { maxMatchDurationSeconds: true } } }, take: 100 })
    let expired = 0
    for (const match of matches) {
      const cutoff = new Date(now.getTime() - match.gameConfig.maxMatchDurationSeconds * 1000)
      const reference = match.status === "STARTED" ? (await transaction.match.findUnique({ where: { id: match.id }, select: { startedAt: true } }))?.startedAt : match.createdAt
      if (!reference || reference > cutoff) continue
      await transaction.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${match.id} FOR UPDATE`
      const current = await transaction.match.findUnique({ where: { id: match.id }, select: { status: true } })
      if (current?.status !== "CREATED" && current?.status !== "STARTED") continue
      await transaction.matchParticipant.updateMany({ where: { matchId: match.id, result: "PENDING" }, data: { result: "FORFEIT", submittedAt: now } })
      await transaction.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "CANCELLED", endedAt: now } })
      await transaction.match.update({ where: { id: match.id }, data: { status: "CANCELLED", endedAt: now } })
      expired += 1
    }
    return { expired }
  }
}
