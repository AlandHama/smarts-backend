import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, PlayerAuditActorType, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export type ReverseWalletInput = { userId: string; ledgerId?: string; originalGrantKey?: string; sourceId: string; actorId?: string; reason?: string }

@Injectable()
export class ReverseWalletTransaction extends PrismaTransaction<ReverseWalletInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: ReverseWalletInput, transaction: Prisma.TransactionClient) {
    if (!input.ledgerId && !input.originalGrantKey) throw new BadRequestException("A ledger id or original grant key is required")
    const original = input.ledgerId
      ? await transaction.walletTransaction.findUnique({ where: { id: input.ledgerId } })
      : await transaction.walletTransaction.findUnique({ where: { grantKey: input.originalGrantKey } })
    if (!original) throw new NotFoundException("Original wallet transaction not found")
    const walletOwner = await transaction.wallet.findUnique({ where: { id: original.walletId }, select: { userId: true } })
    if (!walletOwner || walletOwner.userId !== input.userId) throw new NotFoundException("Original wallet transaction not found")
    if (original.direction === WalletTransactionDirection.REVERSAL) throw new BadRequestException("A reversal cannot be reversed")
    const sourceId = input.sourceId.trim()
    const grantKey = `REVERSAL:${sourceId}:${original.id}`
    const hash = createHash("sha256").update(`${input.userId}:${original.id}:${sourceId}`).digest("hex")
    const scope = `wallet-reversal:${input.userId}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: sourceId } }, create: { userId: input.userId, scope, key: sourceId, requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new ConflictException("The source id was already used for a different reversal")
    const existing = await transaction.walletTransaction.findUnique({ where: { grantKey } })
    if (existing) return this.serialize(existing)
    const balance = await transaction.walletBalance.findUnique({ where: { walletId_currencyId: { walletId: original.walletId, currencyId: original.currencyId } } })
    if (!balance) throw new BadRequestException("Wallet balance no longer exists")
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    const priorReversal = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "WalletTransaction" WHERE "direction" = 'REVERSAL' AND "metadata"->>'reversalOf' = ${original.id} LIMIT 1`)
    if (priorReversal.length) throw new ConflictException("This wallet transaction has already been reversed")
    const after = original.direction === WalletTransactionDirection.CREDIT ? locked.amount - original.amount : locked.amount + original.amount
    if (after < 0n) throw new BadRequestException("Cannot reverse this credit because the balance has already been spent")
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, version: { increment: 1n } } })
    const reversal = await transaction.walletTransaction.create({ data: { walletId: original.walletId, currencyId: original.currencyId, direction: WalletTransactionDirection.REVERSAL, amount: original.amount, balanceBefore: locked.amount, balanceAfter: after, sourceType: WalletTransactionSourceType.REFUND, sourceId, grantKey, idempotencyKeyId: idem.id, metadata: { reversalOf: original.id, reversedDirection: original.direction } } })
    if (input.actorId) await writeAdminAudit(transaction, { actorId: input.actorId, action: "WALLET_REVERSAL", entityType: "WalletTransaction", entityId: reversal.id, reason: input.reason, metadata: { userId: input.userId, originalTransactionId: original.id, sourceId } })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.ADMIN, action: "WALLET_REVERSAL", entityType: "WalletTransaction", entityId: reversal.id, summary: `Reversed wallet transaction ${original.id}`, metadata: { originalTransactionId: original.id, amount: reversal.amount.toString(), sourceId } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: this.serialize(reversal) as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return this.serialize(reversal)
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
