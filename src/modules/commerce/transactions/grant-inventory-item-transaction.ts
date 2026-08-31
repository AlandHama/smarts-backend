import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { InventoryAcquisitionSource, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export type InventoryMutationInput = { userId: string; assetKey: string; variationKey?: string; quantity: number; source: InventoryAcquisitionSource; sourceId: string; metadata?: Record<string, unknown> }

@Injectable()
export class GrantInventoryItemTransaction extends PrismaTransaction<InventoryMutationInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: InventoryMutationInput, transaction: Prisma.TransactionClient) {
    if (input.quantity < 1) throw new BadRequestException("Inventory quantity must be positive")
    const asset = await transaction.assetDefinition.findUnique({ where: { key: input.assetKey.trim().toLowerCase() } })
    if (!asset || !asset.active) throw new NotFoundException("Asset definition not found or inactive")
    const variation = input.variationKey ? await transaction.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: input.variationKey.trim().toLowerCase() } } }) : null
    if (input.variationKey && (!variation || !variation.active)) throw new NotFoundException("Asset variation not found or inactive")
    const scope = `inventory-grant:${input.userId}`
    const idemKey = input.sourceId.trim()
    const requestHash = createHash("sha256").update(JSON.stringify({ userId: input.userId, assetId: asset.id, variationId: variation?.id ?? null, quantity: input.quantity, source: input.source })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: idemKey } }, create: { userId: input.userId, scope, key: idemKey, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new BadRequestException("The source id was already used for another inventory grant")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const stackKey = asset.ownershipPolicy === "STACKABLE" ? `${input.userId}:${asset.id}:${variation?.id ?? "base"}` : null
    if (stackKey) await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${stackKey}))`
    const existing = stackKey ? await transaction.inventoryItem.findFirst({ where: { stackKey } }) : null
    const row = existing
      ? await transaction.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { increment: input.quantity }, sourceId: input.sourceId, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
      : await transaction.inventoryItem.create({ data: { userId: input.userId, assetDefinitionId: asset.id, assetVariationId: variation?.id, quantity: input.quantity, stackKey, acquisitionSource: input.source, sourceId: input.sourceId, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    const result = this.serialize(row)
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return result
  }

  private serialize(row: any) { return { ...row, quantity: row.quantity } }
}
