import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"

type TerminateAdminSessionInput = { sessionId: string; actorId: string; reason?: string }

@Injectable()
export class TerminateAdminSessionTransaction extends PrismaTransaction<TerminateAdminSessionInput, { sessionId: string; terminated: boolean }> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: TerminateAdminSessionInput, transaction: Prisma.TransactionClient) {
    const session = await transaction.session.findUnique({ where: { id: input.sessionId }, select: { id: true, sessionStatus: true } })
    if (!session) throw new NotFoundException("Session not found")
    if (session.sessionStatus === "ACTIVE") {
      await transaction.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${session.id} FOR UPDATE`
      await transaction.session.update({ where: { id: session.id }, data: { sessionStatus: "TERMINATED" } })
      await writeAdminAudit(transaction, { actorId: input.actorId, action: "SESSION_TERMINATE", entityType: "Session", entityId: session.id, reason: input.reason })
      return { sessionId: session.id, terminated: true }
    }
    return { sessionId: session.id, terminated: false }
  }
}
