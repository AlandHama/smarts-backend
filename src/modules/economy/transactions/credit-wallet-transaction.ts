import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Prisma, PlayerAuditActorType, ProgressionRewardType, WalletTransactionDirection, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { writeAdminAudit } from "../../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export type WalletMutationInput = {
  userId: string
  currencyCode: string
  amount: bigint
  amountDecimal?: string
  sourceId: string
  sourceType: WalletTransactionSourceType
  metadata?: Record<string, unknown>
  rewardGrantKey?: string
  policyVersion?: string
  actorId?: string
  reason?: string
}

@Injectable()
export class CreditWalletTransaction extends PrismaTransaction<WalletMutationInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: WalletMutationInput, transaction: Prisma.TransactionClient) {
    const exactAmount = this.parseExactAmount(input.amountDecimal ?? input.amount.toString(), "Credit amount")
    const legacyAmount = BigInt(exactAmount.floor().toFixed(0))
    const code = input.currencyCode.trim().toUpperCase()
    const sourceId = input.sourceId.trim()
    if (!sourceId) throw new BadRequestException("A source id is required")
    const currency = await transaction.currencyDefinition.findUnique({ where: { code }, select: { id: true, active: true } })
    if (!currency || !currency.active) throw new NotFoundException("Currency definition not found or inactive")
    const wallet = await transaction.wallet.findUnique({ where: { userId: input.userId }, select: { id: true, status: true } })
    if (!wallet || wallet.status !== "ACTIVE") throw new BadRequestException("Player wallet is not active")
    const grantKey = `${input.sourceType}:${sourceId}:${input.userId}:${code}`
    const hash = createHash("sha256").update(JSON.stringify({ userId: input.userId, code, amount: legacyAmount.toString(), amountDecimal: exactAmount.toString(), sourceId, sourceType: input.sourceType })).digest("hex")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope: `wallet-credit:${input.userId}:${code}`, key: sourceId } }, create: { userId: input.userId, scope: `wallet-credit:${input.userId}:${code}`, key: sourceId, requestHash: hash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== hash) throw new ConflictException("The source id was already used for a different credit")
    const existing = await transaction.walletTransaction.findUnique({ where: { grantKey } })
    if (existing) {
      await this.ensureRewardGrant(transaction, input, currency.id, existing.amount, existing.exactAmount.toString(), grantKey)
      return this.serializeBalance(existing.exactBalanceAfter, wallet.id, currency.id, code)
    }
    const balance = await transaction.walletBalance.upsert({ where: { walletId_currencyId: { walletId: wallet.id, currencyId: currency.id } }, create: { walletId: wallet.id, currencyId: currency.id, amount: 0n, exactAmount: 0 }, update: {} })
    await transaction.$queryRaw`SELECT "id" FROM "WalletBalance" WHERE "id" = ${balance.id} FOR UPDATE`
    const locked = await transaction.walletBalance.findUniqueOrThrow({ where: { id: balance.id } })
    const exactBefore = locked.exactAmount
    const exactAfter = exactBefore.add(exactAmount)
    const after = BigInt(exactAfter.floor().toFixed(0))
    await transaction.walletBalance.update({ where: { id: locked.id }, data: { amount: after, exactAmount: exactAfter, version: { increment: 1n } } })
    const ledger = await transaction.walletTransaction.create({ data: { walletId: wallet.id, currencyId: currency.id, direction: WalletTransactionDirection.CREDIT, amount: legacyAmount, balanceBefore: locked.amount, balanceAfter: after, exactAmount, exactBalanceBefore: exactBefore, exactBalanceAfter: exactAfter, sourceType: input.sourceType, sourceId, grantKey, idempotencyKeyId: idem.id, metadata: input.metadata as Prisma.InputJsonValue | undefined } })
    await this.ensureRewardGrant(transaction, input, currency.id, legacyAmount, exactAmount.toString(), grantKey)
    if (input.actorId) await writeAdminAudit(transaction, { actorId: input.actorId, action: "WALLET_CREDIT", entityType: "Wallet", entityId: wallet.id, reason: input.reason, metadata: { userId: input.userId, currencyCode: code, amount: input.amount.toString(), sourceId } })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: input.actorId ? PlayerAuditActorType.ADMIN : PlayerAuditActorType.SYSTEM, action: "WALLET_CREDIT", entityType: "WalletTransaction", entityId: ledger.id, summary: `Credited ${input.amount.toString()} ${code}`, changes: { balance: { old: locked.amount, new: after }, amount: { old: 0n, new: input.amount } }, metadata: { currencyCode: code, sourceId, sourceType: input.sourceType } })
    const response = this.serializeBalance(ledger.exactBalanceAfter, wallet.id, currency.id, code)
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    return response
  }

  private serializeBalance(exactAmount: Prisma.Decimal, walletId: string, currencyId: string, code: string) { return { walletId, currencyId, currencyCode: code, amount: exactAmount.floor().toFixed(0), exactAmount: exactAmount.toString() } }

  private parseExactAmount(value: string, label: string) {
    const normalized = String(value).trim()
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new BadRequestException(`${label} must be a non-negative number with up to 6 decimals`)
    const amount = new Prisma.Decimal(normalized)
    if (amount.isNegative()) throw new BadRequestException(`${label} cannot be negative`)
    return amount
  }

  private async ensureRewardGrant(transaction: Prisma.TransactionClient, input: WalletMutationInput, currencyId: string, amount: bigint, amountDecimal: string, walletGrantKey: string) {
    const grantKey = input.rewardGrantKey?.trim() || `wallet:${walletGrantKey}`
    const existing = await transaction.rewardGrant.findUnique({ where: { grantKey } })
    if (existing) return existing
    return transaction.rewardGrant.create({ data: {
      userId: input.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId.trim(),
      rewardType: ProgressionRewardType.CURRENCY,
      grantKey,
      currencyId,
      amount,
      amountDecimal: new Prisma.Decimal(amountDecimal),
      status: "GRANTED",
      policyVersion: input.policyVersion,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    } })
  }
}
