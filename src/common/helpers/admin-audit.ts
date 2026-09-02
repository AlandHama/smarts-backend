import { Prisma } from "@prisma/client"

export type AdminAuditInput = {
  actorId: string
  action: string
  entityType: string
  entityId?: string
  reason?: string
  metadata?: Record<string, unknown>
}

/** Write audit data through the caller's transaction, never through a second client. */
export function writeAdminAudit(transaction: Prisma.TransactionClient, input: AdminAuditInput) {
  const reason = input.reason?.trim() || "System administrator operation"
  return transaction.adminAuditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  }).then(async (audit) => {
    await transaction.outboxEvent.create({
      data: {
        eventType: "system-admin.audit-recorded",
        aggregateType: "AdminAuditEvent",
        aggregateId: audit.id,
        payload: { auditId: audit.id, action: input.action, entityType: input.entityType, entityId: input.entityId, actorId: input.actorId } as Prisma.InputJsonValue,
      },
    })
    return audit
  })
}
