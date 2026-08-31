import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { CatalogRewardType, InventoryAcquisitionSource, Prisma, ProgressionEventSourceType, WalletTransactionSourceType } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { AwardProgressionPointsTransaction } from "../../progression/transactions/award-progression-points-transaction"
import { ResetPlayerProgressionTransaction } from "../../progression/transactions/reset-player-progression-transaction"
import { CreditWalletTransaction } from "../../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../../economy/transactions/debit-wallet-transaction"
import { GrantInventoryItemTransaction } from "./grant-inventory-item-transaction"

export type CreatePurchaseInput = { userId: string; catalogKey?: string; catalogItemKey: string; currencyCode: string; quantity: number; idempotencyKey: string }

@Injectable()
export class CreatePurchaseTransaction extends PrismaTransaction<CreatePurchaseInput, any> {
  constructor(
    prisma: PrismaService,
    private readonly debitWallet: DebitWalletTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly grantInventory: GrantInventoryItemTransaction,
    private readonly awardProgression: AwardProgressionPointsTransaction,
    private readonly resetProgression: ResetPlayerProgressionTransaction,
  ) { super(prisma) }

  protected async execute(input: CreatePurchaseInput, transaction: Prisma.TransactionClient) {
    if (input.quantity < 1 || input.quantity > 99) throw new BadRequestException("Purchase quantity is out of range")
    const itemKey = input.catalogItemKey.trim().toLowerCase()
    const catalogKey = (input.catalogKey ?? "main").trim().toLowerCase()
    const currencyCode = input.currencyCode.trim().toUpperCase()
    const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } })
    if (!user || user.status !== "ACTIVE") throw new BadRequestException("Player account is not active")
    const item = await transaction.catalogItem.findFirst({
      where: { key: itemKey, active: true, purchasable: true, catalog: { key: catalogKey, active: true } },
      include: { catalog: true, assetDefinition: true, prices: { where: { active: true }, include: { currency: true } }, rewards: { orderBy: { sortOrder: "asc" }, include: { assetDefinition: true, assetVariation: true, currency: true, progressionDefinition: true } } },
    })
    if (!item || !this.isAvailable(item.startsAt, item.endsAt) || !this.isAvailable(item.catalog.startsAt, item.catalog.endsAt)) throw new NotFoundException("Catalog item is not available")
    const price = item.prices.find((entry) => entry.currency.code === currencyCode && entry.currency.active)
    if (!price) throw new BadRequestException("This catalog item is not priced in the requested currency")
    const total = price.amount * BigInt(input.quantity)
    const requestHash = createHash("sha256").update(JSON.stringify({ userId: input.userId, catalogKey, itemKey, currencyCode, quantity: input.quantity })).digest("hex")
    const scope = `purchase:${input.userId}`
    const key = input.idempotencyKey.trim()
    if (!key) throw new BadRequestException("An idempotency key is required")
    const idem = await transaction.idempotencyKey.upsert({ where: { scope_key: { scope, key } }, create: { userId: input.userId, scope, key, requestHash, status: "PROCESSING" }, update: {} })
    if (idem.requestHash !== requestHash) throw new ConflictException("The idempotency key was already used for a different purchase")
    if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
    const purchase = await transaction.purchase.create({ data: { userId: input.userId, status: "PENDING", currencyId: price.currencyId, totalAmount: total, idempotencyKeyId: idem.id, provider: "VIRTUAL", metadata: { catalogKey: item.catalog.key } } })
    const rewardSnapshot = { primaryAsset: item.assetDefinition ? { key: item.assetDefinition.key, name: item.assetDefinition.name, quantity: input.quantity } : null, rewards: item.rewards.map((reward) => ({ id: reward.id, rewardType: reward.rewardType, assetKey: reward.assetDefinition?.key ?? null, variationKey: reward.assetVariation?.key ?? null, currencyCode: reward.currency?.code ?? null, progressionKey: reward.progressionDefinition?.key ?? null, targetKey: reward.targetKey, amount: reward.amount?.toString() ?? null, quantity: reward.quantity, sortOrder: reward.sortOrder, metadata: reward.metadata ?? null })) }
    await transaction.purchaseLine.create({ data: { purchaseId: purchase.id, catalogItemId: item.id, itemKeySnapshot: item.key, itemNameSnapshot: item.name, quantity: input.quantity, unitAmount: price.amount, totalAmount: total, rewardSnapshot: rewardSnapshot as Prisma.InputJsonValue } })
    await this.debitWallet.runWithinTransaction({ userId: input.userId, currencyCode, amount: total, sourceId: purchase.id, sourceType: WalletTransactionSourceType.PURCHASE, metadata: { catalogItemKey: item.key, quantity: input.quantity } }, transaction)
    if (item.assetDefinition) await this.grantInventory.runWithinTransaction({ userId: input.userId, assetKey: item.assetDefinition.key, quantity: input.quantity, source: InventoryAcquisitionSource.PURCHASE, sourceId: `${purchase.id}:primary`, metadata: { purchaseId: purchase.id, catalogItemKey: item.key } }, transaction)
    for (const reward of item.rewards) await this.grantReward(transaction, input.userId, purchase.id, item.key, input.quantity, reward)
    const result = { purchaseId: purchase.id, status: "COMPLETED", catalogKey, catalogItemKey: item.key, currencyCode, totalAmount: total.toString(), quantity: input.quantity }
    await transaction.purchase.update({ where: { id: purchase.id }, data: { status: "COMPLETED", completedAt: new Date() } })
    await transaction.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
    await transaction.outboxEvent.create({ data: { eventType: "commerce.purchase.completed", aggregateType: "Purchase", aggregateId: purchase.id, payload: result as unknown as Prisma.InputJsonValue } })
    return result
  }

  private async grantReward(transaction: Prisma.TransactionClient, userId: string, purchaseId: string, itemKey: string, purchaseQuantity: number, reward: any) {
    const sourceId = `${purchaseId}:${reward.id}`
    const quantity = reward.quantity * purchaseQuantity
    if (reward.rewardType === CatalogRewardType.ASSET) {
      if (!reward.assetDefinition) throw new BadRequestException("Asset reward is not configured")
      await this.grantInventory.runWithinTransaction({ userId, assetKey: reward.assetDefinition.key, variationKey: reward.assetVariation?.key, quantity, source: InventoryAcquisitionSource.PURCHASE, sourceId, metadata: { purchaseId, catalogItemKey: itemKey } }, transaction)
    } else if (reward.rewardType === CatalogRewardType.CURRENCY) {
      if (!reward.currency || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Currency reward is not configured")
      await this.creditWallet.runWithinTransaction({ userId, currencyCode: reward.currency.code, amount: reward.amount * BigInt(purchaseQuantity), sourceId, sourceType: WalletTransactionSourceType.PURCHASE, metadata: { purchaseId, catalogItemKey: itemKey } }, transaction)
    } else if (reward.rewardType === CatalogRewardType.PROGRESSION_POINTS) {
      if (!reward.progressionDefinition || !reward.amount || reward.amount <= 0n) throw new BadRequestException("Progression reward is not configured")
      await this.awardProgression.runWithinTransaction({ userId, progressionKey: reward.progressionDefinition.key, amount: reward.amount * BigInt(purchaseQuantity), sourceId, sourceType: ProgressionEventSourceType.PURCHASE, metadata: { purchaseId, catalogItemKey: itemKey } }, transaction)
    } else if (reward.rewardType === CatalogRewardType.PROGRESSION_RESET) {
      if (!reward.progressionDefinition) throw new BadRequestException("Progression reset reward is not configured")
      await this.resetProgression.runWithinTransaction({ userId, progressionKey: reward.progressionDefinition.key, sourceId }, transaction)
    } else if (reward.rewardType === CatalogRewardType.ENTITLEMENT) {
      if (!reward.targetKey) throw new BadRequestException("Entitlement reward is not configured")
      await transaction.entitlement.upsert({ where: { userId_entitlementKey: { userId, entitlementKey: reward.targetKey } }, create: { userId, entitlementKey: reward.targetKey, assetDefinitionId: reward.assetDefinition?.id, status: "ACTIVE", sourceType: "PURCHASE", sourceId, metadata: reward.metadata as Prisma.InputJsonValue | undefined }, update: { status: "ACTIVE", sourceType: "PURCHASE", sourceId, metadata: reward.metadata as Prisma.InputJsonValue | undefined } })
    }
  }

  private isAvailable(startsAt: Date | null, endsAt: Date | null) { const now = Date.now(); return (!startsAt || startsAt.getTime() <= now) && (!endsAt || endsAt.getTime() > now) }
}
