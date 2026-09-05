import { Prisma, PlayerAuditActorType } from "@prisma/client"

export type PlayerAuditInput = {
  userId: string
  action: string
  entityType: string
  entityId?: string
  summary: string
  actorType?: PlayerAuditActorType
  metadata?: Record<string, unknown>
}

/** Write through the caller's transaction so history is atomic with the mutation. */
export function writePlayerAudit(transaction: Prisma.TransactionClient, input: PlayerAuditInput) {
  return transaction.playerAuditEvent.create({
    data: {
      userId: input.userId,
      actorType: input.actorType ?? PlayerAuditActorType.SYSTEM,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
