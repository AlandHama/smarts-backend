import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomUUID } from "node:crypto"
import { InventoryAcquisitionSource, PlayerAuditActorType, Prisma, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { writePlayerAudit } from "../../../common/helpers/player-audit"
import { PrismaService } from "../../../prisma.service"
import { ConfigService } from "../../config/config.service"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { GrantInventoryItemTransaction } from "../../commerce/transactions/grant-inventory-item-transaction"
import { catalogGldPrice, catalogGldPricingMode } from "../../commerce/catalog-gld-pricing"
import { getGldConfig } from "../../gld/gld.config"
import { SendGiftDto } from "../dtos/gift.dto"

type SendGiftInput = { senderUserId: string; dto: SendGiftDto }

@Injectable()
export class SendGiftTransaction extends PrismaTransaction<SendGiftInput, any> {
  constructor(
    prisma: PrismaService,
    private readonly debitWallet: DebitWalletTransaction,
    private readonly grantInventory: GrantInventoryItemTransaction,
    private readonly configService: ConfigService,
  ) { super(prisma) }

  protected async execute(input: SendGiftInput, transaction: Prisma.TransactionClient) {
    const senderUserId = input.senderUserId
    const recipientUserId = input.dto.recipientUserId
    if (senderUserId === recipientUserId) throw new BadRequestException("You cannot send a gift to yourself")
    const controls = await transaction.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    if (controls.giftsPaused) throw new ConflictException("GLD gifts are temporarily paused")
    const itemKey = input.dto.catalogItemKey.trim().toLowerCase()
    const catalogKey = "main"
    const idempotencyKey = input.dto.idempotencyKey.trim()
    if (!idempotencyKey) throw new BadRequestException("An idempotency key is required")

    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gld-gift:${senderUserId}:${recipientUserId}:${itemKey}`}))`
    const [sender, recipient] = await Promise.all([
      transaction.user.findUnique({ where: { id: senderUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true } } } }),
      transaction.user.findUnique({ where: { id: recipientUserId }, select: { id: true, username: true, status: true, profile: { select: { displayName: true, isPublic: true } } } }),
    ])
    if (!sender || sender.status !== "ACTIVE") throw new BadRequestException("Sender account is not active")
    if (!recipient || recipient.status !== "ACTIVE") throw new NotFoundException("Recipient account not found")

    const requireFriendship = process.env.GLD_GIFT_REQUIRE_FRIENDSHIP === "true"
    if (requireFriendship) {
      const friendship = await transaction.friendship.findFirst({ where: { OR: [{ userId: senderUserId, friendId: recipientUserId }, { userId: recipientUserId, friendId: senderUserId }] }, select: { id: true } })
      if (!friendship) throw new BadRequestException("You must be friends before sending a gift")
    }

    const policy = await this.configService.getActivePrivate<any>("gld-gifts").catch(() => ({ privateConfig: {} }))
    const dailyLimit = Math.max(1, Number(policy.privateConfig.dailySendLimit ?? process.env.GLD_GIFT_DAILY_SEND_LIMIT ?? 50) || 50)
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const sentToday = await transaction.playerGift.count({ where: { senderUserId, createdAt: { gte: startOfDay } } })
    if (sentToday >= dailyLimit) throw new BadRequestException("Daily gift sending limit reached")

    const item = await transaction.catalogItem.findFirst({
      where: { key: itemKey, active: true, purchasable: true, catalog: { key: catalogKey, active: true } },
      include: { catalog: true, assetDefinition: { select: { key: true, name: true, imageUrl: true, metadata: true } }, prices: { where: { active: true }, include: { currency: { select: { id: true, code: true, active: true } } } } },
    })
    if (!item || !this.isAvailable(item.startsAt, item.endsAt) || !this.isAvailable(item.catalog.startsAt, item.catalog.endsAt)) throw new NotFoundException("Gift catalog item is not available")
    if (!this.isGiftItem(item.metadata)) throw new BadRequestException("This catalog item is not configured as a gift")
    if (!item.assetDefinition) throw new BadRequestException("This gift is missing its primary asset configuration")
    let price: any = item.prices.find((entry) => entry.currency.code === "GLD" && entry.currency.active)
    const state = await transaction.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { displayedValueUsdMicros: true } })
    const dynamicAmount = state?.displayedValueUsdMicros
      ? catalogGldPrice({ catalogMetadata: item.metadata, assetMetadata: item.assetDefinition.metadata, currentGldValueUsdMicros: state.displayedValueUsdMicros, storedGldPrice: price?.amount ?? null })
      : null
    if (catalogGldPricingMode(item.metadata) === "AUTO" && dynamicAmount === null) throw new BadRequestException("Automatic GLD pricing requires an asset USD cost and a current GLD value")
    if (dynamicAmount !== null) {
      const currency = price?.currency ?? await transaction.currencyDefinition.findUnique({ where: { code: "GLD" } })
      if (currency?.active) price = { ...(price ?? {}), amount: dynamicAmount, currencyId: currency.id, currency }
    }
    if (!price || price.amount <= 0n) throw new BadRequestException("This gift is not priced in GLD")
    const giftFeeBps = this.giftFeeBps(item.metadata)
    const giftFeeAmount = (price.amount * BigInt(giftFeeBps) + 9_999n) / 10_000n
    const chargedAmount = price.amount + giftFeeAmount

    const requestHash = createHash("sha256").update(JSON.stringify({ senderUserId, recipientUserId, catalogKey, itemKey })).digest("hex")
    const scope = `gift:${senderUserId}`
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key: idempotencyKey } }, create: { userId: senderUserId, scope, key: idempotencyKey, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The idempotency key was already used for a different gift")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const existingGift = await transaction.playerGift.findUnique({ where: { idempotencyKeyId: idem.id } })
    if (existingGift) return this.serialize(existingGift)

    const config = getGldConfig()
    const giftControls = await transaction.gldAdminControl.findUnique({ where: { singletonKey: "default" }, select: { giftBurnBps: true } })
    const burnedAmount = price.amount * BigInt(giftControls?.giftBurnBps ?? config.giftBurnBps) / 10_000n + giftFeeAmount
    const retainedAmount = chargedAmount - burnedAmount
    const giftId = randomUUID()
    const wallet = await this.debitWallet.runWithinTransaction({ userId: senderUserId, currencyCode: "GLD", amount: chargedAmount, sourceId: giftId, sourceType: WalletTransactionSourceType.PURCHASE, metadata: { reason: "GLD_GIFT_PURCHASE", recipientUserId, catalogItemKey: item.key, giftFeeAmount: giftFeeAmount.toString(), giftFeeBps, chargedAmount: chargedAmount.toString(), burnedAmount: burnedAmount.toString(), retainedAmount: retainedAmount.toString() } }, transaction)
    const ledger = await transaction.walletTransaction.findUnique({ where: { grantKey: `PURCHASE:${giftId}:${senderUserId}:GLD` }, select: { id: true } })
    await transaction.gldBurnEvent.create({ data: { userId: senderUserId, amount: burnedAmount, sourceType: "GIFT_PURCHASE", sourceId: giftId, ledgerEntryId: ledger?.id, reason: "Digital gift burn and fee", metadata: { recipientUserId, catalogItemKey: item.key, gldPrice: price.amount.toString(), giftFeeAmount: giftFeeAmount.toString(), giftFeeBps, chargedAmount: chargedAmount.toString(), retainedAmount: retainedAmount.toString() } } })
    const gift = await transaction.playerGift.create({ data: { id: giftId, senderUserId, recipientUserId, catalogItemId: item.id, gldPrice: price.amount, giftFeeAmount, chargedAmount, burnedAmount, retainedAmount, idempotencyKeyId: idem.id } })
    if (item.assetDefinition) {
      const variationKey = this.metadataString(item.metadata, "variationKey")
      await this.grantInventory.runWithinTransaction({ userId: recipientUserId, assetKey: item.assetDefinition.key, variationKey, quantity: 1, source: InventoryAcquisitionSource.SYSTEM, sourceId: `${gift.id}:asset`, metadata: { reason: "GLD_GIFT_RECEIVED", giftId: gift.id, senderUserId, catalogItemKey: item.key } }, transaction)
    }

    const result = this.serialize({ giftId: gift.id, status: "SENT", senderUserId, recipientUserId, recipientName: recipient.profile?.displayName ?? recipient.username, catalogItemKey: item.key, catalogItemName: item.name, assetKey: item.assetDefinition?.key ?? null, imageUrl: item.imageUrl ?? item.assetDefinition?.imageUrl ?? null, gldPrice: price.amount, giftFeeAmount, giftFeeBps, chargedAmount, burnedAmount, retainedAmount, balanceAfter: wallet.amount, createdAt: gift.createdAt })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as Prisma.InputJsonValue, completedAt: new Date() } })
    await transaction.outboxEvent.create({ data: { eventType: "gift.received", aggregateType: "PlayerGift", aggregateId: gift.id, payload: { giftId: gift.id, userId: recipientUserId, recipientUserId, senderUserId, senderName: sender.profile?.displayName ?? sender.username, catalogItemKey: item.key, catalogItemName: item.name, amount: price.amount.toString(), giftFeeAmount: giftFeeAmount.toString(), chargedAmount: chargedAmount.toString() } as Prisma.InputJsonValue } })
    await transaction.outboxEvent.create({ data: { eventType: "gift.sent", aggregateType: "PlayerGift", aggregateId: gift.id, payload: { giftId: gift.id, userId: senderUserId, recipientUserId, recipientName: recipient.profile?.displayName ?? recipient.username, catalogItemKey: item.key, catalogItemName: item.name, amount: price.amount.toString(), giftFeeAmount: giftFeeAmount.toString(), chargedAmount: chargedAmount.toString() } as Prisma.InputJsonValue } })
    await writePlayerAudit(transaction, { userId: senderUserId, actorType: PlayerAuditActorType.PLAYER, action: "GLD_GIFT_SENT", entityType: "PlayerGift", entityId: gift.id, summary: `Sent ${item.name} to ${recipient.profile?.displayName ?? recipient.username}`, changes: { gldBalance: { old: null, new: wallet.amount } }, metadata: { recipientUserId, catalogItemKey: item.key, price: price.amount.toString(), burnedAmount: burnedAmount.toString() } })
    await writePlayerAudit(transaction, { userId: recipientUserId, actorType: PlayerAuditActorType.SYSTEM, action: "GLD_GIFT_RECEIVED", entityType: "PlayerGift", entityId: gift.id, summary: `Received ${item.name} from ${sender.profile?.displayName ?? sender.username}`, metadata: { senderUserId, catalogItemKey: item.key, price: price.amount.toString() } })
    return result
  }

  private isGiftItem(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
    const value = metadata as Record<string, unknown>
    return value.gift === true || value.isGift === true || value.kind === "GIFT" || value.type === "GIFT"
  }

  private metadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
    const value = (metadata as Record<string, unknown>)[key]
    return typeof value === "string" ? value : undefined
  }

  private giftFeeBps(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0
    const raw = (metadata as Record<string, unknown>).giftFeePercent
    const percent = typeof raw === "number" && Number.isInteger(raw) ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0
    return Math.min(Math.max(percent, 0), 100) * 100
  }

  private isAvailable(startsAt: Date | null, endsAt: Date | null) { const now = Date.now(); return (!startsAt || startsAt.getTime() <= now) && (!endsAt || endsAt.getTime() > now) }
  private serialize(value: unknown): any { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
