import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { WalletMutationInput } from "./credit-wallet-transaction"

@Injectable()
export class DebitWalletTransaction extends PrismaTransaction<WalletMutationInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: WalletMutationInput, transaction: Prisma.TransactionClient) {
    if (input.amount <= 0n) throw new BadRequestException("Debit amount must be positive")
    const code = input.currencyCode.trim().toUpperCase()
    const sourceId = input.sourceId.trim()
    const currency = await transaction.currencyDefinition.findUnique({ where: { code }, select: { id: true, active: true } })
    if (!currency || !currency.active) throw new NotFoundException("Currency definition not found or inactive")
    const wallet = await transaction.wallet.findUnique({ where: { userId: input.userId }, select: { id: true, status: true } })
    if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
    const grantKey = `${input.sourceType}:${sourceId}:${input.userId}:${code}`
    const hash = createHash("sha256").update(JSON.stringify({ userId: input.userId, code, amount: input.amount.toString(), sourceId, sourceType: input.sourceType })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: `wallet-debit:${input.userId}:${code}`, key: sourceId } }, create: { userId: input.userId, scope: `wallet-debit:${input.userId}:${code}`, key: sourceId, requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new ConflictException("The source id was already used for a different debit")
    const existing = await transaction.walletTransaction.findUnique({ where: { grantKey } })
    if (existing) return this.serializeBalance(existing.balanceAfter, wallet.id, currency.id, code)
    const balance = await transaction.walletBalance.findUnique({ where: { walletId_currencyId: { walletId: wallet.id, currencyId: currency.id } } })
    if (!balance) throw new BadRequestException("Player wallet does not contain this currency")
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    if (locked.amount < input.amount) throw new BadRequestException("Insufficient wallet balance")
    const after = locked.amount - input.amount
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, version: { increment: 1n } } })
    const ledger = await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId: currency.id, direction: WalletTransactionDirection.DEBIT, amount: input.amount, balanceBefore: locked.amount, balanceAfter: after, sourceType: input.sourceType, sourceId, grantKey, idempotencyKeyId: idem.id, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    const response = this.serializeBalance(ledger.balanceAfter, wallet.id, currency.id, code)
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }

  private serializeBalance(amount: bigint, walletId: string, currencyId: string, code: string) { return { walletId, currencyId, currencyCode: code, amount: amount.toString() } }
}

