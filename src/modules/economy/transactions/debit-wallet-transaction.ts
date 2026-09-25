import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, PlayerAuditActorType, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { WalletMutationInput } from "./credit-wallet-transaction"

@Injectable()
export class DebitWalletTransaction extends PrismaTransaction<WalletMutationInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: WalletMutationInput, transaction: Prisma.TransactionClient) {
    const exactAmount = this.parseExactAmount(input.amountDecimal ?? input.amount.toString())
    if (exactAmount.lte(0)) throw new BadRequestException("Debit amount must be positive")
    const legacyAmount = BigInt(exactAmount.floor().toFixed(0))
    const code = input.currencyCode.trim().toUpperCase()
    const sourceId = input.sourceId.trim()
    const currency = await transaction.currencyDefinition.findUnique({ where: { code }, select: { id: true, active: true } })
    if (!currency || !currency.active) throw new NotFoundException("Currency definition not found or inactive")
    const wallet = await transaction.wallet.findUnique({ where: { userId: input.userId }, select: { id: true, status: true } })
    if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
    const grantKey = `${input.sourceType}:${sourceId}:${input.userId}:${code}`
    const hash = createHash("sha256").update(JSON.stringify({ userId: input.userId, code, amount: legacyAmount.toString(), amountDecimal: exactAmount.toString(), sourceId, sourceType: input.sourceType })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: `wallet-debit:${input.userId}:${code}`, key: sourceId } }, create: { userId: input.userId, scope: `wallet-debit:${input.userId}:${code}`, key: sourceId, requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new ConflictException("The source id was already used for a different debit")
    const existing = await transaction.walletTransaction.findUnique({ where: { grantKey } })
    if (existing) return this.serializeBalance(existing.exactBalanceAfter, wallet.id, currency.id, code)
    const balance = await transaction.walletBalance.findUnique({ where: { walletId_currencyId: { walletId: wallet.id, currencyId: currency.id } } })
    if (!balance) throw new BadRequestException("Player wallet does not contain this currency")
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    if (locked.exactAmount.lt(exactAmount)) throw new BadRequestException("Insufficient wallet balance")
    const exactAfter = locked.exactAmount.sub(exactAmount)
    const after = BigInt(exactAfter.floor().toFixed(0))
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, exactAmount: exactAfter, version: { increment: 1n } } })
    const ledger = await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId: currency.id, direction: WalletTransactionDirection.DEBIT, amount: legacyAmount, balanceBefore: locked.amount, balanceAfter: after, exactAmount, exactBalanceBefore: locked.exactAmount, exactBalanceAfter: exactAfter, sourceType: input.sourceType, sourceId, grantKey, idempotencyKeyId: idem.id, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    const response = this.serializeBalance(ledger.exactBalanceAfter, wallet.id, currency.id, code)
    if (input.actorId) await writeAdminAudit(transaction, { actorId: input.actorId, action: "WALLET_DEBIT", entityType: "Wallet", entityId: wallet.id, reason: input.reason, metadata: { userId: input.userId, currencyCode: code, amount: input.amount.toString(), sourceId } })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: input.actorId ? PlayerAuditActorType.ADMIN : PlayerAuditActorType.SYSTEM, action: "WALLET_DEBIT", entityType: "WalletTransaction", entityId: ledger.id, summary: `Debited ${exactAmount.toString()} ${code}`, changes: { balance: { old: locked.exactAmount.toString(), new: exactAfter.toString() }, amount: { old: "0", new: exactAmount.toString() } }, metadata: { currencyCode: code, sourceId, sourceType: input.sourceType } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }

  private serializeBalance(exactAmount: Prisma.Decimal, walletId: string, currencyId: string, code: string) { return { walletId, currencyId, currencyCode: code, amount: exactAmount.floor().toFixed(0), exactAmount: exactAmount.toString() } }

  private parseExactAmount(value: string) {
    const normalized = String(value).trim()
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new BadRequestException("Debit amount must be a positive number with up to 6 decimals")
    return new Prisma.Decimal(normalized)
  }
}
