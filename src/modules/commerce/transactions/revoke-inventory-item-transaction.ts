import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"

export type RevokeInventoryInput = { userId: string; assetKey: string; variationKey?: string; quantity: number; sourceId: string; metadata?: Record<string, unknown> }

@Injectable()
export class RevokeInventoryItemTransaction extends PrismaTransaction<RevokeInventoryInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: RevokeInventoryInput, transaction: Prisma.TransactionClient) {
    if (input.quantity < 1) throw new BadRequestException("Inventory quantity must be positive")
    const asset = await transaction.assetDefinition.findUnique({ where: { key: input.assetKey.trim().toLowerCase() } })
    if (!asset) throw new NotFoundException("Asset definition not found")
    const variation = input.variationKey ? await transaction.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: input.variationKey.trim().toLowerCase() } } }) : null
    const scope = `inventory-revoke:${input.userId}`
    const idemKey = input.sourceId.trim()
    const requestHash = createHash("sha256").update(JSON.stringify({ userId: input.userId, assetId: asset.id, variationId: variation?.id ?? null, quantity: input.quantity })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: idemKey } }, create: { userId: input.userId, scope, key: idemKey, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new BadRequestException("The source id was already used for another inventory revoke")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const stackKey = asset.ownershipPolicy === "STACKABLE" ? `${input.userId}:${asset.id}:${variation?.id ?? "base"}` : null
    // pg_advisory_xact_lock returns PostgreSQL's `void` type; this is a
    // command, so executeRaw avoids Prisma deserializing a void result.
    if (stackKey) await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stackKey}))`
    const row = stackKey ? await transaction.inventoryItem.findFirst({ where: { stackKey } }) : await transaction.inventoryItem.findFirst({ where: { userId: input.userId, assetDefinitionId: asset.id, assetVariationId: variation?.id ?? null }, orderBy: { createdAt: "asc" } })
    if (!row || row.quantity < input.quantity) throw new BadRequestException("Player does not own enough of this asset")
    const updated = row.quantity === input.quantity
      ? await transaction.inventoryItem.delete({ where: { id: row.id } })
      : await transaction.inventoryItem.update({ where: { id: row.id }, data: { quantity: { decrement: input.quantity }, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    const result = { removed: input.quantity, assetKey: asset.key, inventoryItemId: row.id, remaining: row.quantity - input.quantity, deleted: row.quantity === input.quantity, sourceId: input.sourceId }
    const actorId = typeof input.metadata?.actorId === "string" ? input.metadata.actorId : undefined
    if (actorId) await writeAdminAudit(transaction, { actorId, action: "INVENTORY_REVOKE", entityType: "InventoryItem", entityId: row.id, reason: typeof input.metadata?.reason === "string" ? input.metadata.reason : undefined, metadata: { userId: input.userId, assetKey: asset.key, quantity: input.quantity, sourceId: input.sourceId } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return result
  }
}
