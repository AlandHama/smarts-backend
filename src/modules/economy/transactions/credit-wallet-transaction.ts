import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"

export type WalletMutationInput = {
  userId: string
  currencyCode: string
  amount: bigint
  sourceId: string
  sourceType: WalletTransactionSourceType
  metadata?: Record<string, unknown>
}

@Injectable()
export class CreditWalletTransaction extends PrismaTransaction<WalletMutationInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: WalletMutationInput, transaction: Prisma.TransactionClient) {
    if (input.amount < 0n) throw new BadRequestException("Credit amount cannot be negative")
    const code = input.currencyCode.trim().toUpperCase()
    const sourceId = input.sourceId.trim()
    if (!sourceId) throw new BadRequestException("A source id is required")
    const currency = await transaction.currencyDefinition.findUnique({ where: { code }, select: { id: true, active: true } })
    if (!currency || !currency.active) throw new NotFoundException("Currency definition not found or inactive")
    const wallet = await transaction.wallet.findUnique({ where: { userId: input.userId }, select: { id: true, status: true } })
    if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
    const grantKey = `${input.sourceType}:${sourceId}:${input.userId}:${code}`
    const hash = createHash("sha256").update(JSON.stringify({ userId: input.userId, code, amount: input.amount.toString(), sourceId, sourceType: input.sourceType })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: `wallet-credit:${input.userId}:${code}`, key: sourceId } }, create: { userId: input.userId, scope: `wallet-credit:${input.userId}:${code}`, key: sourceId, requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new ConflictException("The source id was already used for a different credit")
    const existing = await transaction.walletTransaction.findUnique({ where: { grantKey } })
    if (existing) return this.serializeBalance(existing.balanceAfter, wallet.id, currency.id, code)
    const balance = await transaction.walletBalance.upsert({ where: { walletId_currencyId: { walletId: wallet.id, currencyId: currency.id } }, create: { walletId: wallet.id, currencyId: currency.id, amount: 0n }, update: {} })
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    const after = locked.amount + input.amount
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, version: { increment: 1n } } })
    const ledger = await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId: currency.id, direction: WalletTransactionDirection.CREDIT, amount: input.amount, balanceBefore: locked.amount, balanceAfter: after, sourceType: input.sourceType, sourceId, grantKey, idempotencyKeyId: idem.id, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    const response = this.serializeBalance(ledger.balanceAfter, wallet.id, currency.id, code)
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }

  private serializeBalance(amount: bigint, walletId: string, currencyId: string, code: string) { return { walletId, currencyId, currencyCode: code, amount: amount.toString() } }
}

