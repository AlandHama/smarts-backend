import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomUUID } from "node:crypto"
import { Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreditWalletTransaction } from "./credit-wallet-transaction"
import { DebitWalletTransaction } from "./debit-wallet-transaction"
import { GldTransferDto } from "../dtos"

type TransferInput = { senderUserId: string; dto: GldTransferDto }

@Injectable()
export class TransferGldTransaction extends PrismaTransaction<TransferInput, any> {
  constructor(prisma: PrismaService, private readonly debitWallet: DebitWalletTransaction, private readonly creditWallet: CreditWalletTransaction) { super(prisma) }

  protected async execute(input: TransferInput, transaction: Prisma.TransactionClient) {
    const recipientUserId = input.dto.recipientUserId.trim()
    const amount = this.parseAmount(input.dto.amount)
    const idempotencyKey = input.dto.idempotencyKey.trim()
    if (!recipientUserId || recipientUserId === input.senderUserId) throw new BadRequestException("Choose another player")
    if (!idempotencyKey) throw new BadRequestException("An idempotency key is required")
    const requestHash = createHash("sha256").update(JSON.stringify({ senderUserId: input.senderUserId, recipientUserId, amount: amount.toString() })).digest("hex")
    const scope = `gld-transfer:${input.senderUserId}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: idempotencyKey } }, create: { userId: input.senderUserId, scope, key: idempotencyKey, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The idempotency key was already used for a different transfer")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const [sender, recipient] = await Promise.all([
      transaction.user.findUnique({ where: { id: input.senderUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true } } } }),
      transaction.user.findUnique({ where: { id: recipientUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true } } } }),
    ])
    if (!sender || sender.status !== "ACTIVE") throw new BadRequestException("Sender account is not active")
    if (!recipient || recipient.status !== "ACTIVE") throw new NotFoundException("Recipient account not found")
    const controls = await transaction.gldAdminControl.findUnique({ where: { singletonKey: "default" }, select: { gldTransferFeeBps: true } })
    const feeBps = controls?.gldTransferFeeBps ?? 0
    const feeAmount = (amount * BigInt(feeBps) + 9_999n) / 10_000n
    const totalDebit = amount + feeAmount
    const transferId = randomUUID()
    const lockKey = [input.senderUserId, recipientUserId].sort().join(":")
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gld-transfer:${lockKey}`}))`
    const debit = await this.debitWallet.runWithinTransaction({ userId: input.senderUserId, currencyCode: "GLD", amount: totalDebit, sourceId: transferId, sourceType: WalletTransactionSourceType.SYSTEM, metadata: { reason: "GLD_PLAYER_TRANSFER", recipientUserId, amount: amount.toString(), feeAmount: feeAmount.toString(), feeBps } }, transaction)
    const credit = await this.creditWallet.runWithinTransaction({ userId: recipientUserId, currencyCode: "GLD", amount, sourceId: transferId, sourceType: WalletTransactionSourceType.SYSTEM, metadata: { reason: "GLD_PLAYER_TRANSFER", senderUserId: input.senderUserId, amount: amount.toString(), feeAmount: feeAmount.toString(), feeBps } }, transaction)
    if (feeAmount > 0n) {
      const ledger = await transaction.walletTransaction.findUnique({ where: { grantKey: `SYSTEM:${transferId}:${input.senderUserId}:GLD` }, select: { id: true } })
      await transaction.gldBurnEvent.create({ data: { userId: input.senderUserId, amount: feeAmount, sourceType: "GLD_TRANSFER_FEE", sourceId: transferId, ledgerEntryId: ledger?.id, reason: "GLD player transfer fee", metadata: { recipientUserId, amount: amount.toString(), feeBps } } })
      const dateKey = new Date().toISOString().slice(0, 10)
      await transaction.gldEmissionDay.upsert({ where: { dateKey }, create: { dateKey, emissionBudget: 0n, burnedAmount: feeAmount }, update: { burnedAmount: { increment: feeAmount } } })
    }
    const result = this.serialize({ transferId, status: "COMPLETED", senderUserId: input.senderUserId, recipientUserId, amount, feeAmount, totalDebit, feeBps, balanceAfter: debit.amount, recipientBalanceAfter: credit.amount, createdAt: new Date() })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as Prisma.InputJsonValue, completedAt: new Date() } })
    await transaction.outboxEvent.create({ data: { eventType: "gld.transfer.sent", aggregateType: "WalletTransfer", aggregateId: transferId, payload: { userId: input.senderUserId, recipientUserId, recipientName: recipient.profile?.displayName ?? recipient.username, amount: amount.toString(), feeAmount: feeAmount.toString() } as Prisma.InputJsonValue } })
    await transaction.outboxEvent.create({ data: { eventType: "gld.transfer.received", aggregateType: "WalletTransfer", aggregateId: transferId, payload: { userId: recipientUserId, senderUserId: input.senderUserId, senderName: sender.profile?.displayName ?? sender.username, amount: amount.toString() } as Prisma.InputJsonValue } })
    return result
  }

  private parseAmount(value: string) { if (!/^\d+$/.test(value.trim()) || BigInt(value) <= 0n) throw new BadRequestException("Transfer amount must be a positive whole number"); return BigInt(value) }
  private serialize(value: unknown): any { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
