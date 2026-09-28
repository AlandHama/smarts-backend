import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomUUID } from "node:crypto"
import { PlayerAuditActorType, Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { PrismaService } from "../../../prisma.service"
import { ConfigService } from "../../config/config.service"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { SendGiftDto } from "../dtos/gift.dto"

type SendGiftInput = { senderUserId: string; dto: SendGiftDto }

@Injectable()
export class SendGiftTransaction extends PrismaTransaction<SendGiftInput, any> {
  constructor(
    prisma: PrismaService,
    private readonly debitWallet: DebitWalletTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly configService: ConfigService,
  ) { super(prisma) }

  protected async execute(input: SendGiftInput, transaction: Prisma.TransactionClient) {
    const senderUserId = input.senderUserId
    const recipientUserId = input.dto.recipientUserId
    if (senderUserId === recipientUserId) throw new BadRequestException("You cannot send a gift to yourself")
    const controls = await transaction.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    if (controls.giftsPaused) throw new ConflictException("GLD gifts are temporarily paused")

    const giftKey = (input.dto.socialGiftKey || input.dto.catalogItemKey || "").trim().toLowerCase()
    const idempotencyKey = input.dto.idempotencyKey.trim()
    if (!giftKey) throw new BadRequestException("A social gift key is required")
    if (!idempotencyKey) throw new BadRequestException("An idempotency key is required")

    const lockUsers = [senderUserId, recipientUserId].sort().join(":")
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`social-gift:${lockUsers}:${giftKey}`}))`
    const [sender, recipient] = await Promise.all([
      transaction.user.findUnique({ where: { id: senderUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true } } } }),
      transaction.user.findUnique({ where: { id: recipientUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true } } } }),
    ])
    if (!sender || sender.status !== "ACTIVE") throw new BadRequestException("Sender account is not active")
    if (!recipient || recipient.status !== "ACTIVE") throw new NotFoundException("Recipient account not found")

    if (process.env.GLD_GIFT_REQUIRE_FRIENDSHIP === "true") {
      const friendship = await transaction.friendship.findFirst({ where: { OR: [{ userId: senderUserId, friendId: recipientUserId }, { userId: recipientUserId, friendId: senderUserId }] }, select: { id: true } })
      if (!friendship) throw new BadRequestException("You must be friends before sending a gift")
    }

    const policy = await this.configService.getActivePrivate<any>("gld-gifts").catch(() => ({ privateConfig: {} }))
    const dailyLimit = Math.max(1, Number(policy.privateConfig.dailySendLimit ?? process.env.GLD_GIFT_DAILY_SEND_LIMIT ?? 50) || 50)
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const sentToday = await transaction.playerGift.count({ where: { senderUserId, createdAt: { gte: startOfDay } } })
    if (sentToday >= dailyLimit) throw new BadRequestException("Daily gift sending limit reached")

    const definition = await transaction.socialGiftDefinition.findFirst({ where: { key: giftKey, active: true } })
    if (!definition || definition.priceGld <= 0n) throw new NotFoundException("Social gift is not available")
    if (definition.recipientRewardBps < 0 || definition.recipientRewardBps > 10_000) throw new BadRequestException("Social gift reward configuration is invalid")

    const price = definition.priceGld
    const recipientAmountDecimal = new Prisma.Decimal(price.toString()).mul(definition.recipientRewardBps).div(10_000).toDecimalPlaces(6)
    const burnedAmountDecimal = new Prisma.Decimal(price.toString()).sub(recipientAmountDecimal)
    const recipientAmount = BigInt(recipientAmountDecimal.floor().toFixed(0))
    const burnedAmount = BigInt(burnedAmountDecimal.floor().toFixed(0))
    const requestHash = createHash("sha256").update(JSON.stringify({ senderUserId, recipientUserId, giftKey })).digest("hex")
    const scope = `social-gift:${senderUserId}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: idempotencyKey } }, create: { userId: senderUserId, scope, key: idempotencyKey, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The idempotency key was already used for a different gift")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const existingGift = await transaction.playerGift.findUnique({ where: { idempotencyKeyId: idem.id } })
    if (existingGift) return this.serialize(existingGift)

    const giftId = randomUUID()
    const wallet = await this.debitWallet.runWithinTransaction({
      userId: senderUserId,
      currencyCode: "GLD",
      amount: price,
      sourceId: giftId,
      sourceType: WalletTransactionSourceType.PURCHASE,
      metadata: { reason: "GLD_SOCIAL_GIFT_SENT", recipientUserId, socialGiftKey: definition.key, chargedAmount: price.toString(), recipientAmount: recipientAmountDecimal.toString(), recipientRewardBps: definition.recipientRewardBps, burnedAmount: burnedAmountDecimal.toString() },
    }, transaction)
    const ledger = await transaction.walletTransaction.findUnique({ where: { grantKey: `PURCHASE:${giftId}:${senderUserId}:GLD` }, select: { id: true } })
    await transaction.gldBurnEvent.create({ data: { userId: senderUserId, amount: burnedAmount, exactAmount: burnedAmountDecimal, sourceType: "GIFT_PURCHASE", sourceId: giftId, ledgerEntryId: ledger?.id, reason: "Social gift allocation burn", metadata: { recipientUserId, socialGiftKey: definition.key, priceGld: price.toString(), recipientAmount: recipientAmountDecimal.toString(), recipientRewardBps: definition.recipientRewardBps } } })
    const gift = await transaction.playerGift.create({ data: { id: giftId, senderUserId, recipientUserId, catalogItemId: null, socialGiftDefinitionId: definition.id, gldPrice: price, giftFeeAmount: 0n, chargedAmount: price, burnedAmount, retainedAmount: 0n, burnedAmountDecimal, retainedAmountDecimal: 0, recipientAmount: recipientAmountDecimal, recipientRewardBps: definition.recipientRewardBps, idempotencyKeyId: idem.id } })
    if (recipientAmountDecimal.gt(0)) {
      await this.creditWallet.runWithinTransaction({ userId: recipientUserId, currencyCode: "GLD", amount: recipientAmount, amountDecimal: recipientAmountDecimal.toString(), sourceId: giftId, sourceType: WalletTransactionSourceType.SYSTEM, metadata: { reason: "GLD_SOCIAL_GIFT_RECEIVED", senderUserId, socialGiftKey: definition.key, giftId, senderAmount: price.toString(), recipientAmount: recipientAmountDecimal.toString(), recipientRewardBps: definition.recipientRewardBps } }, transaction)
    }

    const result = this.serialize({ giftId: gift.id, status: "SENT", senderUserId, recipientUserId, recipientName: recipient.profile?.displayName ?? recipient.username, socialGiftKey: definition.key, socialGiftName: definition.name, icon: definition.icon, gldPrice: price, chargedAmount: price, giftFeeAmount: 0n, recipientAmount: recipientAmountDecimal, recipientRewardBps: definition.recipientRewardBps, burnedAmount: burnedAmountDecimal, balanceAfter: wallet.amount, createdAt: gift.createdAt })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as Prisma.InputJsonValue, completedAt: new Date() } })
    await transaction.outboxEvent.create({ data: { eventType: "gift.received", aggregateType: "PlayerGift", aggregateId: gift.id, payload: { giftId: gift.id, userId: recipientUserId, recipientUserId, senderUserId, senderName: sender.profile?.displayName ?? sender.username, socialGiftKey: definition.key, socialGiftName: definition.name, icon: definition.icon, amount: price.toString(), recipientAmount: recipientAmountDecimal.toString(), recipientRewardBps: definition.recipientRewardBps } as Prisma.InputJsonValue } })
    await transaction.outboxEvent.create({ data: { eventType: "gift.sent", aggregateType: "PlayerGift", aggregateId: gift.id, payload: { giftId: gift.id, userId: senderUserId, recipientUserId, recipientName: recipient.profile?.displayName ?? recipient.username, socialGiftKey: definition.key, socialGiftName: definition.name, icon: definition.icon, amount: price.toString(), recipientAmount: recipientAmountDecimal.toString(), recipientRewardBps: definition.recipientRewardBps } as Prisma.InputJsonValue } })
    await writePlayerAudit(transaction, { userId: senderUserId, actorType: PlayerAuditActorType.PLAYER, action: "GLD_GIFT_SENT", entityType: "PlayerGift", entityId: gift.id, summary: `Sent ${definition.name} to ${recipient.profile?.displayName ?? recipient.username}`, changes: { gldBalance: { old: null, new: wallet.amount } }, metadata: { recipientUserId, socialGiftKey: definition.key, price: price.toString(), burnedAmount: burnedAmountDecimal.toString() } })
    await writePlayerAudit(transaction, { userId: recipientUserId, actorType: PlayerAuditActorType.SYSTEM, action: "GLD_GIFT_RECEIVED", entityType: "PlayerGift", entityId: gift.id, summary: `Received ${definition.name} from ${sender.profile?.displayName ?? sender.username}`, metadata: { senderUserId, socialGiftKey: definition.key, price: price.toString(), recipientAmount: recipientAmountDecimal.toString() } })
    return result
  }

  private serialize(value: unknown): any {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item))
  }
}
