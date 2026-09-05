import { Prisma, PlayerAuditActorType } from "@prisma/client"

export type PlayerAuditInput = {
  userId: string
  action: string
  entityType: string
  entityId?: string
  summary: string
  actorType?: PlayerAuditActorType
  changes?: Record<string, { old: unknown; new: unknown; description?: string }>
  metadata?: Record<string, unknown>
}

function jsonSafe(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item)) as Prisma.InputJsonValue
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)])) as Prisma.InputJsonValue
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  return String(value)
}

function safeChanges(changes?: PlayerAuditInput["changes"]) {
  if (!changes || !Object.keys(changes).length) return undefined
  return jsonSafe(changes) as Prisma.InputJsonValue
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
      changes: safeChanges(input.changes),
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
