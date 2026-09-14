import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma, PurchaseStatus, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { BulkRedeemCodeDto, CreateAssetDto, CreateCatalogDto, CreateCatalogItemDto, InventoryMutationDto, InventoryQueryDto, PaidRewardDecisionDto, PaidRewardRequestDto, UpdateAssetDto, UpdateCatalogDto, UpdateCatalogItemDto } from "./dtos"
import { CreateCatalogItemTransaction } from "./transactions/create-catalog-item-transaction"
import { CreatePurchaseTransaction } from "./transactions/create-purchase-transaction"
import { GrantInventoryItemTransaction } from "./transactions/grant-inventory-item-transaction"
import { RevokeInventoryItemTransaction } from "./transactions/revoke-inventory-item-transaction"
import { StorageService } from "../storage/storage.service"
import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../common/helpers/player-audit"
import { createHash, randomUUID } from "node:crypto"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../economy/transactions/debit-wallet-transaction"
import { getGldConfig } from "../gld/gld.config"

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createCatalogItemTransaction: CreateCatalogItemTransaction,
    private readonly createPurchaseTransaction: CreatePurchaseTransaction,
    private readonly grantInventoryTransaction: GrantInventoryItemTransaction,
    private readonly revokeInventoryTransaction: RevokeInventoryItemTransaction,
    private readonly storageService: StorageService,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly debitWallet: DebitWalletTransaction,
  ) {}

  async listCatalog(key: string, includeInactive = false) {
    const now = new Date()
    const catalog = await this.prisma.catalog.findUnique({ where: { key: key.trim().toLowerCase() }, include: { items: { where: includeInactive ? undefined : { active: true, purchasable: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] }, orderBy: { name: "asc" }, take: 500, include: this.itemInclude() } } })
    if (!catalog || (!includeInactive && (!catalog.active || !this.isAvailable(catalog.startsAt, catalog.endsAt)))) throw new NotFoundException("Catalog not found")
    return this.storageService.normalizePublicImageUrls(this.serialize(catalog))
  }

  listCatalogs(includeInactive = false) { return this.prisma.catalog.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 100, include: { items: { orderBy: { name: "asc" }, take: 500, include: this.itemInclude() } } }).then((value) => this.storageService.normalizePublicImageUrls(this.serialize(value))) }

  async createCatalog(dto: CreateCatalogDto) {
    return this.prisma.$transaction(async (tx) => this.serialize(await tx.catalog.create({ data: { key: dto.key.trim().toLowerCase(), name: dto.name.trim(), description: dto.description, active: dto.active ?? true, startsAt: this.date(dto.startsAt), endsAt: this.date(dto.endsAt), metadata: dto.metadata as Prisma.InputJsonValue | undefined } })))
  }

  async updateCatalog(id: string, dto: UpdateCatalogDto) {
    return this.prisma.$transaction(async (tx) => this.serialize(await tx.catalog.update({ where: { id }, data: { ...(dto.key === undefined ? {} : { key: dto.key.trim().toLowerCase() }), ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.description === undefined ? {} : { description: dto.description }), ...(dto.active === undefined ? {} : { active: dto.active }), ...(dto.startsAt === undefined ? {} : { startsAt: this.date(dto.startsAt) }), ...(dto.endsAt === undefined ? {} : { endsAt: this.date(dto.endsAt) }), ...(dto.metadata === undefined ? {} : { metadata: dto.metadata as Prisma.InputJsonValue }) } })))
  }

  async listAssets(includeInactive = true) { return this.prisma.assetDefinition.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { key: "asc" }, take: 500, include: { variations: { orderBy: { key: "asc" }, take: 100 } } }).then((value) => this.storageService.normalizePublicImageUrls(this.serialize(value))) }

  async createAsset(dto: CreateAssetDto) {
    const key = this.assetKey(dto.key)
    try {
      const value = await this.prisma.assetDefinition.create({ data: { key, name: dto.name.trim(), description: dto.description, assetType: dto.assetType, ownershipPolicy: dto.ownershipPolicy, imageUrl: dto.imageUrl, imageAlt: dto.imageAlt, imageUrls: dto.imageUrls as Prisma.InputJsonValue | undefined, active: true, metadata: dto.metadata as Prisma.InputJsonValue | undefined } })
      return this.serialize(value)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`An asset with the key "${key}" already exists. Choose a different stable key or edit the existing asset.`)
      }
      throw error
    }
  }

  async updateAsset(id: string, dto: UpdateAssetDto) {
    const key = dto.key === undefined ? undefined : this.assetKey(dto.key)
    try {
      const value = await this.prisma.assetDefinition.update({ where: { id }, data: { ...(key === undefined ? {} : { key }), ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.description === undefined ? {} : { description: dto.description }), ...(dto.assetType === undefined ? {} : { assetType: dto.assetType }), ...(dto.ownershipPolicy === undefined ? {} : { ownershipPolicy: dto.ownershipPolicy }), ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }), ...(dto.imageAlt === undefined ? {} : { imageAlt: dto.imageAlt }), ...(dto.imageUrls === undefined ? {} : { imageUrls: dto.imageUrls as Prisma.InputJsonValue }), ...(dto.active === undefined ? {} : { active: dto.active }), ...(dto.metadata === undefined ? {} : { metadata: dto.metadata as Prisma.InputJsonValue }) } })
      return this.serialize(value)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`An asset with the key "${key}" already exists. Choose a different stable key.`)
      }
      throw error
    }
  }

  createCatalogItem(dto: CreateCatalogItemDto) { return this.createCatalogItemTransaction.run(dto).then((value) => this.serialize(value)) }

  async updateCatalogItem(id: string, dto: UpdateCatalogItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.catalogItem.findUnique({ where: { id } })
      if (!item) throw new NotFoundException("Catalog item not found")
      let assetDefinitionId: string | null | undefined
      if (dto.assetKey !== undefined) {
        const asset = await tx.assetDefinition.findUnique({ where: { key: dto.assetKey.trim().toLowerCase() } })
        if (!asset) throw new NotFoundException("Asset definition not found")
        assetDefinitionId = asset.id
      }
      const updated = await tx.catalogItem.update({ where: { id }, data: { ...(dto.key === undefined ? {} : { key: dto.key.trim().toLowerCase() }), ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.description === undefined ? {} : { description: dto.description }), ...(assetDefinitionId === undefined ? {} : { assetDefinitionId }), ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }), ...(dto.imageAlt === undefined ? {} : { imageAlt: dto.imageAlt }), ...(dto.imageUrls === undefined ? {} : { imageUrls: dto.imageUrls as Prisma.InputJsonValue }), ...(dto.purchasable === undefined ? {} : { purchasable: dto.purchasable }), ...(dto.active === undefined ? {} : { active: dto.active }), ...(dto.startsAt === undefined ? {} : { startsAt: this.date(dto.startsAt) }), ...(dto.endsAt === undefined ? {} : { endsAt: this.date(dto.endsAt) }), ...(dto.metadata === undefined ? {} : { metadata: dto.metadata as Prisma.InputJsonValue }) } })
      if (dto.prices) {
        await tx.catalogPrice.deleteMany({ where: { catalogItemId: id } })
        for (const price of dto.prices) {
          if (!/^\d+$/.test(price.amount) || BigInt(price.amount) <= 0n) throw new BadRequestException("Catalog prices must be positive integer minor units")
          const currency = await tx.currencyDefinition.findUnique({ where: { code: price.currencyCode.trim().toUpperCase() } })
          if (!currency || !currency.active) throw new BadRequestException(`Currency ${price.currencyCode} is not active`)
          await tx.catalogPrice.create({ data: { catalogItemId: id, currencyId: currency.id, amount: BigInt(price.amount), active: price.active ?? true } })
        }
      }
      if (dto.rewards) {
        await tx.catalogReward.deleteMany({ where: { catalogItemId: id } })
        for (const reward of dto.rewards) {
          const data: any = { rewardType: reward.rewardType, targetKey: reward.targetKey, amount: reward.amount === undefined ? undefined : BigInt(reward.amount), quantity: reward.quantity ?? 1, sortOrder: reward.sortOrder ?? 0, metadata: reward.metadata as Prisma.InputJsonValue | undefined }
          if (data.quantity < 1 || data.quantity > 1000000) throw new BadRequestException("Reward quantity is out of range")
          if (data.amount !== undefined && (data.amount < 0n || !/^\d+$/.test(String(reward.amount)))) throw new BadRequestException("Reward amount must be a non-negative integer")
          if (reward.assetKey) {
            const asset = await tx.assetDefinition.findUnique({ where: { key: reward.assetKey.trim().toLowerCase() } })
            if (!asset) throw new NotFoundException(`Asset ${reward.assetKey} not found`)
            data.assetDefinitionId = asset.id
            if (reward.variationKey) {
              const variation = await tx.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: reward.variationKey.trim().toLowerCase() } } })
              if (!variation) throw new NotFoundException(`Variation ${reward.variationKey} not found`)
              data.assetVariationId = variation.id
            }
          }
          if (reward.currencyCode) {
            const currency = await tx.currencyDefinition.findUnique({ where: { code: reward.currencyCode.trim().toUpperCase() } })
            if (!currency || !currency.active) throw new BadRequestException(`Currency ${reward.currencyCode} is not active`)
            data.currencyId = currency.id
          }
          if (reward.progressionKey) {
            const progression = await tx.progressionDefinition.findUnique({ where: { key: reward.progressionKey.trim().toLowerCase() } })
            if (!progression || !progression.active) throw new BadRequestException(`Progression ${reward.progressionKey} is not active`)
            data.progressionDefinitionId = progression.id
          }
          await tx.catalogReward.create({ data: { catalogItemId: id, ...data } })
        }
      }
      return this.serialize(await tx.catalogItem.findUniqueOrThrow({ where: { id: updated.id }, include: this.itemInclude() }))
    })
  }

  listInventory(query: InventoryQueryDto) {
    const page = query.page ?? 1; const limit = query.limit ?? 25
    const where: Prisma.InventoryItemWhereInput = query.userId ? { userId: query.userId } : query.search ? { user: { OR: [{ username: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }, { profile: { displayName: { contains: query.search, mode: "insensitive" } } }] } } : {}
    return this.prisma.$transaction([this.prisma.inventoryItem.count({ where }), this.prisma.inventoryItem.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, assetDefinition: true, assetVariation: true } })]).then(([total, items]) => ({ items: this.serialize(items), pagination: { page, limit, total, pages: Math.ceil(total / limit) } }))
  }

  listPlayerInventory(userId: string) { return this.prisma.inventoryItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, include: { assetDefinition: true, assetVariation: true } }).then((value) => this.serialize(value)) }
  listPlayerEntitlements(userId: string) { return this.prisma.entitlement.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, include: { assetDefinition: true } }).then((value) => this.serialize(value)) }
  listPurchases(userId?: string) { return this.prisma.purchase.findMany({ where: userId ? { userId } : undefined, orderBy: { createdAt: "desc" }, take: 500, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, currency: { select: { code: true, name: true } }, lines: true } }).then((value) => this.serialize(value)) }

  purchase(userId: string, input: { catalogKey?: string; catalogItemKey: string; currencyCode: string; quantity: number; idempotencyKey: string }) { return this.createPurchaseTransaction.run({ userId, ...input }) }
  grantInventory(userId: string, dto: InventoryMutationDto, actorId: string) { return this.grantInventoryTransaction.run({ userId, assetKey: dto.assetKey, variationKey: dto.variationKey, quantity: dto.quantity, source: dto.source ?? "ADMIN", sourceId: dto.sourceId, metadata: { actorId, reason: dto.reason } }) }
  revokeInventory(userId: string, dto: InventoryMutationDto, actorId: string) { return this.revokeInventoryTransaction.run({ userId, assetKey: dto.assetKey, variationKey: dto.variationKey, quantity: dto.quantity, sourceId: dto.sourceId, metadata: { actorId, reason: dto.reason } }) }

  async getPaidRewardQuote(assetKey: string, variationKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.assetDefinition.findUnique({ where: { key: this.assetKey(assetKey) } })
      if (!asset || !asset.active) throw new NotFoundException("Asset definition not found or inactive")
      const variation = variationKey ? await tx.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: variationKey.trim().toLowerCase() } } }) : null
      if (variationKey && (!variation || !variation.active)) throw new NotFoundException("Asset variation not found or inactive")
      const quote = await this.paidRewardQuote(tx, asset, variation?.id ?? null)
      return this.serialize({ asset: { key: asset.key, name: asset.name }, variation: variation ? { key: variation.key, name: variation.name } : null, ...quote })
    })
  }

  async requestPaidReward(userId: string, dto: PaidRewardRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.assetDefinition.findUnique({ where: { key: dto.assetKey.trim().toLowerCase() } })
      if (!asset || !asset.active) throw new NotFoundException("Asset definition not found or inactive")
      if (asset.ownershipPolicy !== "UNIQUE") throw new BadRequestException("Paid redeem-code assets must use UNIQUE ownership")
      const variation = dto.variationKey ? await tx.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: dto.variationKey.trim().toLowerCase() } } }) : null
      if (dto.variationKey && (!variation || !variation.active)) throw new NotFoundException("Asset variation not found or inactive")
      const inventoryItem = dto.inventoryItemId
        ? await tx.inventoryItem.findFirst({ where: { id: dto.inventoryItemId, userId, assetDefinitionId: asset.id, assetVariationId: variation?.id ?? null } })
        : null
      if (dto.inventoryItemId && !inventoryItem) throw new NotFoundException("The requested inventory item was not found")
      const existingRequest = inventoryItem
        ? await tx.paidRewardRequest.findFirst({ where: { userId, inventoryItemId: inventoryItem.id }, orderBy: { requestedAt: "desc" }, include: { assetDefinition: true, assetVariation: true, redeemCode: true } })
        : null
      if (existingRequest) return this.playerPaidReward(existingRequest)
      const idempotencyKey = dto.idempotencyKey.trim()
      if (!idempotencyKey) throw new BadRequestException("idempotencyKey is required")
      const requestHash = createHash("sha256").update(JSON.stringify({ userId, assetId: asset.id, variationId: variation?.id ?? null, inventoryItemId: inventoryItem?.id ?? null, message: dto.message?.trim() ?? null })).digest("hex")
      const idem = await tx.idempotencyKey.upsert({ where: { scope_key: { scope: `paid-reward-request:${userId}`, key: idempotencyKey } }, create: { userId, scope: `paid-reward-request:${userId}`, key: idempotencyKey, requestHash, status: "PROCESSING" }, update: {} })
      if (idem.requestHash !== requestHash) throw new ConflictException("The request idempotency key is invalid")
      if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paid-reward:${userId}`}))`
      if (inventoryItem) await tx.$executeRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${inventoryItem.id} FOR UPDATE`
      const lockedExistingRequest = inventoryItem
        ? await tx.paidRewardRequest.findFirst({ where: { userId, inventoryItemId: inventoryItem.id }, orderBy: { requestedAt: "desc" }, include: { assetDefinition: true, assetVariation: true, redeemCode: true } })
        : null
      if (lockedExistingRequest) return this.playerPaidReward(lockedExistingRequest)
      const available = await tx.assetRedeemCode.count({ where: { assetDefinitionId: asset.id, assetVariationId: variation?.id ?? null, status: "AVAILABLE" } })
      if (!available) throw new ConflictException("This asset is temporarily out of redeem codes")
      if (inventoryItem?.metadata && typeof inventoryItem.metadata === "object" && !Array.isArray(inventoryItem.metadata) && "redemptionKey" in inventoryItem.metadata) throw new ConflictException("This inventory item already has a redeem code")
      const quote = await this.paidRewardQuote(tx, asset, variation?.id ?? null)
      if (!quote.eligible) throw new ConflictException(quote.reason)
      const dayStart = new Date()
      dayStart.setUTCHours(0, 0, 0, 0)
      const dailyRequests = await tx.paidRewardRequest.count({ where: { userId, requestedAt: { gte: dayStart } } })
      const config = getGldConfig()
      if (dailyRequests >= config.paidRewardDailyRequestLimit) throw new ConflictException("The daily paid reward request limit has been reached")
      const requestId = randomUUID()
      const request = await tx.paidRewardRequest.create({ data: { id: requestId, userId, assetDefinitionId: asset.id, assetVariationId: variation?.id, inventoryItemId: inventoryItem?.id, gldPrice: quote.gldPrice, gldUnitPriceUsdMicros: quote.displayedValueUsdMicros, reserveCostUsdMicros: quote.reserveCostUsdMicros, gldFeeAmount: quote.feeGldAmount, requestKey: createHash("sha256").update(`${userId}:${idempotencyKey}`).digest("hex"), message: dto.message?.trim() || undefined, idempotencyKeyId: idem.id }, include: { assetDefinition: true, assetVariation: true, redeemCode: true } })
      await this.debitWallet.runWithinTransaction({ userId, currencyCode: "GLD", amount: quote.gldPrice, sourceId: request.id, sourceType: WalletTransactionSourceType.PURCHASE, metadata: { reason: "GLD_PAID_REWARD_REQUEST", assetKey: asset.key, inventoryItemId: inventoryItem?.id ?? null, safetyMarginBps: quote.safetyMarginBps } }, tx)
      const result = this.playerPaidReward(request)
      await tx.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: result as Prisma.InputJsonValue, completedAt: new Date() } })
      return result
    })
  }

  listPaidRewardRequests(userId: string) {
    return this.prisma.paidRewardRequest.findMany({ where: { userId }, orderBy: { requestedAt: "desc" }, take: 100, include: { assetDefinition: { select: { id: true, key: true, name: true, imageUrl: true } }, assetVariation: { select: { id: true, key: true, name: true } }, redeemCode: { select: { id: true, code: true, status: true, assignedAt: true } } } }).then((rows) => rows.map((row) => this.playerPaidReward(row)))
  }

  async listAdminPaidRewardRequests(status?: string) {
    const normalized = status?.trim().toUpperCase()
    if (normalized && !["PENDING", "FULFILLED", "REFUSED"].includes(normalized)) throw new BadRequestException("Paid reward request status is invalid")
    const rows = await this.prisma.paidRewardRequest.findMany({ where: normalized ? { status: normalized as any } : undefined, orderBy: { requestedAt: "desc" }, take: 500, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, assetDefinition: { select: { id: true, key: true, name: true, imageUrl: true } }, assetVariation: { select: { id: true, key: true, name: true } }, redeemCode: { select: { id: true, code: true, status: true, assignedAt: true } }, decidedBy: { select: { id: true, username: true } } } })
    return rows.map((row) => this.adminPaidReward(row))
  }

  async decidePaidRewardRequest(id: string, dto: PaidRewardDecisionDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "PaidRewardRequest" WHERE "id" = ${id} FOR UPDATE`
      const request = await tx.paidRewardRequest.findUnique({ where: { id }, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, assetDefinition: true, assetVariation: true, redeemCode: true } })
      if (!request) throw new NotFoundException("Paid reward request not found")
      if (request.status !== "PENDING") return this.adminPaidReward(request)
      const now = new Date()
      if (dto.status === "REFUSED") {
        const refundable = (request.gldPrice ?? 0n) - request.gldRefundedAmount
        if (refundable > 0n) {
          await this.creditWallet.runWithinTransaction({ userId: request.userId, currencyCode: "GLD", amount: refundable, sourceId: `paid-reward-refund:${id}`, sourceType: WalletTransactionSourceType.REFUND, rewardGrantKey: `GLD_PAID_REWARD_REFUND:${id}`, metadata: { reason: "GLD_PAID_REWARD_REFUSED", paidRewardRequestId: id, assetKey: request.assetDefinition.key } }, tx)
        }
        const updated = await tx.paidRewardRequest.update({ where: { id }, data: { status: "REFUSED", gldRefundedAmount: { increment: refundable }, adminNote: dto.adminNote?.trim() || undefined, decidedById: actorId, decidedAt: now }, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, assetDefinition: true, assetVariation: true, redeemCode: true, decidedBy: { select: { id: true, username: true } } } })
        await writeAdminAudit(tx, { actorId, action: "PAID_REWARD_REFUSED", entityType: "PaidRewardRequest", entityId: id, reason: dto.adminNote, metadata: { userId: request.userId, assetKey: request.assetDefinition.key } })
        await writePlayerAudit(tx, { userId: request.userId, actorType: PlayerAuditActorType.ADMIN, action: "PAID_REWARD_REFUSED", entityType: "PaidRewardRequest", entityId: id, summary: `Paid reward request for ${request.assetDefinition.name} was refused${refundable > 0n ? `; ${refundable.toString()} GLD was refunded` : ""}`, changes: { status: { old: "PENDING", new: "REFUSED" }, gldRefundedAmount: { old: request.gldRefundedAmount, new: request.gldRefundedAmount + refundable } }, metadata: { assetKey: request.assetDefinition.key, adminNote: dto.adminNote, refundedGld: refundable.toString() } })
        await tx.outboxEvent.create({ data: { eventType: "commerce.paid-reward.refused", aggregateType: "PaidRewardRequest", aggregateId: id, payload: { userId: request.userId, requestId: id, assetKey: request.assetDefinition.key, refundedGld: refundable.toString() } as Prisma.InputJsonValue } })
        return this.adminPaidReward(updated)
      }
      if (request.assetDefinition.ownershipPolicy !== "UNIQUE") throw new BadRequestException("Paid redeem-code assets must use UNIQUE ownership")
      const legacyPrice = request.gldPrice && !request.gldUnitPriceUsdMicros
        ? (await tx.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { displayedValueUsdMicros: true } }))?.displayedValueUsdMicros
        : null
      const gldUnitPriceUsdMicros = request.gldUnitPriceUsdMicros ?? legacyPrice ?? null
      const reserveCostUsdMicros = request.reserveCostUsdMicros ?? (request.gldPrice && gldUnitPriceUsdMicros ? this.gldToUsdMicros(request.gldPrice, gldUnitPriceUsdMicros) : 0n)
      if (reserveCostUsdMicros > 0n) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('SMARTS_GLD_TREASURY'))`
        const reserveResult = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COALESCE(SUM(CASE WHEN "entryType" = 'RESERVE' OR ("entryType" = 'ADJUSTMENT' AND "metadata"->>'allocation' = 'RESERVE') OR "entryType" = 'COST' THEN "amountUsdMicros" ELSE 0 END), 0)::bigint AS total FROM "GldTreasuryEntry"`)
        const availableReserve = reserveResult[0]?.total ?? 0n
        if (availableReserve < reserveCostUsdMicros) throw new ConflictException("The GLD reserve cannot cover this reward's reserve cost")
      }
      const lockKey = `${request.assetDefinitionId}:${request.assetVariationId ?? "base"}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const code = await tx.assetRedeemCode.findFirst({ where: { assetDefinitionId: request.assetDefinitionId, assetVariationId: request.assetVariationId, status: "AVAILABLE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
      if (!code) throw new ConflictException("No redeem code is available for this asset")
      const legacyInventory = request.inventoryItemId ? null : (await tx.inventoryItem.findMany({ where: { userId: request.userId, assetDefinitionId: request.assetDefinitionId, assetVariationId: request.assetVariationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 })).find((item) => {
        const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {}
        return typeof metadata.redemptionKey !== "string" || !metadata.redemptionKey
      })
      const targetInventoryId = request.inventoryItemId ?? legacyInventory?.id
      const inventory = targetInventoryId
        ? await this.attachRedeemCodeToInventory(tx, targetInventoryId, request.userId, id, code.code, actorId, dto.adminNote)
        : await this.grantInventoryTransaction.runWithinTransaction({ userId: request.userId, assetKey: request.assetDefinition.key, variationKey: request.assetVariation?.key, quantity: 1, source: "PAID_REWARD", sourceId: `paid-reward-request:${id}`, metadata: { requestId: id, redemptionKey: code.code, redeemCode: code.code, actorId, reason: dto.adminNote?.trim() || "Paid reward request approved" } }, tx)
      await tx.assetRedeemCode.update({ where: { id: code.id }, data: { status: "ASSIGNED", assignedUserId: request.userId, assignedAt: now, requestId: id } })
      const updated = await tx.paidRewardRequest.update({ where: { id }, data: { status: "FULFILLED", adminNote: dto.adminNote?.trim() || undefined, inventoryItemId: inventory.id, decidedById: actorId, decidedAt: now }, include: { user: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, assetDefinition: true, assetVariation: true, redeemCode: true, decidedBy: { select: { id: true, username: true } } } })
      if ((request.gldPrice ?? 0n) > 0n) {
        const existingBurn = await tx.gldBurnEvent.findFirst({ where: { sourceType: "PAID_REWARD_FULFILLMENT", sourceId: id }, select: { id: true } })
        if (!existingBurn) {
          await tx.gldBurnEvent.create({ data: { userId: request.userId, amount: request.gldPrice!, sourceType: "PAID_REWARD_FULFILLMENT", sourceId: id, reason: `Fulfilled paid reward ${request.assetDefinition.key}`, metadata: { assetKey: request.assetDefinition.key, redeemCodeId: code.id, gldUnitPriceUsdMicros: gldUnitPriceUsdMicros?.toString() ?? null, reserveCostUsdMicros: reserveCostUsdMicros.toString() } } })
          const dateKey = now.toISOString().slice(0, 10)
          await tx.gldEmissionDay.upsert({ where: { dateKey }, create: { dateKey, emissionBudget: 0n, burnedAmount: request.gldPrice! }, update: { burnedAmount: { increment: request.gldPrice! } } })
        }
        if (reserveCostUsdMicros > 0n) {
          await tx.gldTreasuryEntry.create({ data: { entryType: "COST", amountUsdMicros: -reserveCostUsdMicros, idempotencyKey: `paid-reward-reserve-cost:${id}`, metadata: { source: "PAID_REWARD_FULFILLMENT", paidRewardRequestId: id, assetKey: request.assetDefinition.key, redeemCodeId: code.id, gldAmount: request.gldPrice!.toString(), gldUnitPriceUsdMicros: gldUnitPriceUsdMicros?.toString() ?? null, feeGldAmount: request.gldFeeAmount?.toString() ?? null } } })
        }
      }
      await writeAdminAudit(tx, { actorId, action: "PAID_REWARD_FULFILLED", entityType: "PaidRewardRequest", entityId: id, reason: dto.adminNote, metadata: { userId: request.userId, assetKey: request.assetDefinition.key, redeemCodeId: code.id, inventoryItemId: inventory.id } })
      await writePlayerAudit(tx, { userId: request.userId, actorType: PlayerAuditActorType.ADMIN, action: "PAID_REWARD_FULFILLED", entityType: "PaidRewardRequest", entityId: id, summary: `Paid reward ${request.assetDefinition.name} fulfilled`, changes: { status: { old: "PENDING", new: "FULFILLED" } }, metadata: { assetKey: request.assetDefinition.key, redeemCodeId: code.id, gldSpent: (request.gldPrice ?? 0n).toString() } })
      await tx.outboxEvent.create({ data: { eventType: "commerce.paid-reward.fulfilled", aggregateType: "PaidRewardRequest", aggregateId: id, payload: { userId: request.userId, requestId: id, assetKey: request.assetDefinition.key, redeemCode: code.code } as Prisma.InputJsonValue } })
      return this.adminPaidReward(updated)
    })
  }

  async bulkInsertRedeemCodes(dto: BulkRedeemCodeDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.assetDefinition.findUnique({ where: { key: dto.assetKey.trim().toLowerCase() } })
      if (!asset || !asset.active) throw new NotFoundException("Asset definition not found or inactive")
      if (asset.ownershipPolicy !== "UNIQUE") throw new BadRequestException("Redeem-code assets must use UNIQUE ownership")
      const variation = dto.variationKey ? await tx.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: dto.variationKey.trim().toLowerCase() } } }) : null
      if (dto.variationKey && (!variation || !variation.active)) throw new NotFoundException("Asset variation not found or inactive")
      const codes = [...new Set(dto.codes.map((value) => value.trim()).filter(Boolean))]
      if (!codes.length) throw new BadRequestException("At least one redeem code is required")
      const result = await tx.assetRedeemCode.createMany({ data: codes.map((code) => ({ assetDefinitionId: asset.id, assetVariationId: variation?.id, code, codeHash: createHash("sha256").update(code.toUpperCase()).digest("hex") })), skipDuplicates: true })
      await writeAdminAudit(tx, { actorId, action: "REDEEM_CODES_BULK_INSERT", entityType: "AssetDefinition", entityId: asset.id, reason: "Bulk redeem codes inserted from the system administrator console", metadata: { assetKey: asset.key, variationKey: variation?.key, submitted: codes.length, inserted: result.count } })
      return { assetKey: asset.key, variationKey: variation?.key ?? null, submitted: codes.length, inserted: result.count, skipped: codes.length - result.count }
    })
  }

  async listRedeemCodes(assetKey?: string, status?: string) {
    const normalizedStatus = status?.trim().toUpperCase()
    if (normalizedStatus && !["AVAILABLE", "ASSIGNED", "VOID"].includes(normalizedStatus)) throw new BadRequestException("Redeem code status is invalid")
    const rows = await this.prisma.assetRedeemCode.findMany({ where: { ...(assetKey ? { assetDefinition: { key: assetKey.trim().toLowerCase() } } : {}), ...(normalizedStatus ? { status: normalizedStatus as any } : {}) }, orderBy: { createdAt: "desc" }, take: 1000, include: { assetDefinition: { select: { id: true, key: true, name: true } }, assetVariation: { select: { id: true, key: true, name: true } }, assignedUser: { select: { id: true, username: true, email: true, profile: { select: { displayName: true } } } }, request: { select: { id: true, status: true, requestedAt: true } } } })
    return rows.map((row) => ({ ...row, code: row.code }))
  }

  private itemInclude() { return { assetDefinition: { select: { id: true, key: true, name: true, imageUrl: true } }, prices: { where: { active: true }, include: { currency: { select: { code: true, name: true, precision: true, active: true } } } }, rewards: { orderBy: { sortOrder: "asc" as const }, include: { assetDefinition: { select: { key: true, name: true, imageUrl: true } }, assetVariation: { select: { key: true, name: true, imageUrl: true } }, currency: { select: { code: true, name: true } }, progressionDefinition: { select: { key: true, name: true } } } } } }
  private async attachRedeemCodeToInventory(tx: Prisma.TransactionClient, inventoryItemId: string, userId: string, requestId: string, code: string, actorId: string, adminNote?: string) {
    const item = await tx.inventoryItem.findFirst({ where: { id: inventoryItemId, userId } })
    if (!item) throw new NotFoundException("The requested inventory item was not found")
    const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {}
    if (typeof metadata.redemptionKey === "string" && metadata.redemptionKey) throw new ConflictException("This inventory item already has a redeem code")
    return tx.inventoryItem.update({ where: { id: item.id }, data: { metadata: { ...metadata, requestId, redemptionKey: code, redeemCode: code, actorId, reason: adminNote?.trim() || "Paid reward request approved" } as Prisma.InputJsonValue } })
  }
  private date(value?: string) { return value ? new Date(value) : undefined }
  private assetKey(value: string) { return value.trim().toLowerCase() }
  private isAvailable(startsAt: Date | null, endsAt: Date | null) { const now = Date.now(); return (!startsAt || startsAt.getTime() <= now) && (!endsAt || endsAt.getTime() > now) }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
  private async paidRewardQuote(tx: Prisma.TransactionClient, asset: any, variationId: string | null) {
    const config = getGldConfig()
    const state = await tx.gldEconomyState.findFirst({ orderBy: { updatedAt: "desc" }, select: { displayedValueUsdMicros: true, health: true } })
    const controls = await tx.gldAdminControl.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default" }, update: {} })
    const displayedValueUsdMicros = state?.displayedValueUsdMicros ?? config.initialPriceUsdMicros
    const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {}
    const rawCost = metadata.usdCostMicros ?? metadata.costUsdMicros ?? metadata.rewardCostUsdMicros ?? metadata.usdValueMicros
    let usdCostMicros = typeof rawCost === "string" && /^\d+$/.test(rawCost) ? BigInt(rawCost) : typeof rawCost === "number" && Number.isSafeInteger(rawCost) ? BigInt(rawCost) : null
    if (usdCostMicros === null && typeof metadata.usdCost === "number" && Number.isFinite(metadata.usdCost)) usdCostMicros = BigInt(Math.ceil(metadata.usdCost * 1_000_000))
    if (usdCostMicros === null && typeof metadata.usdCost === "string" && /^\d+(\.\d{1,6})?$/.test(metadata.usdCost)) usdCostMicros = BigInt(Math.ceil(Number(metadata.usdCost) * 1_000_000))
    usdCostMicros = usdCostMicros && usdCostMicros > 0n ? usdCostMicros : config.paidRewardDefaultCostUsdMicros
    const safeDisplayedValue = displayedValueUsdMicros > 0n ? displayedValueUsdMicros : config.initialPriceUsdMicros
    // Both values are USD micros, so their direct ratio is the GLD amount.
    const baseGldPrice = (usdCostMicros + safeDisplayedValue - 1n) / safeDisplayedValue
    const marginGldPrice = (baseGldPrice * BigInt(config.paidRewardSafetyMarginBps) + 10_000n - 1n) / 10_000n
    const directGldPrice = (usdCostMicros * BigInt(config.paidRewardSafetyMarginBps) + safeDisplayedValue - 1n) / safeDisplayedValue
    const gldPrice = [baseGldPrice, marginGldPrice, directGldPrice].reduce((maximum, value) => value > maximum ? value : maximum, 0n)
    const reserveCostUsdMicros = this.gldToUsdMicros(baseGldPrice, safeDisplayedValue)
    const feeGldAmount = gldPrice > baseGldPrice ? gldPrice - baseGldPrice : 0n
    const availableCodes = await tx.assetRedeemCode.count({ where: { assetDefinitionId: asset.id, assetVariationId: variationId, status: "AVAILABLE" } })
    const blockedByHealth = config.paidRewardPauseOnCritical && (state?.health ?? "CRITICAL") === "CRITICAL"
    const reason = controls.paidRewardsPaused ? "Paid rewards are temporarily paused by an administrator" : blockedByHealth ? "Paid rewards are temporarily paused while the GLD reserve is critical" : availableCodes < 1 ? "This asset is temporarily out of redeem codes" : "Eligible"
    return { gldPrice: gldPrice > 0n ? gldPrice : 1n, baseGldPrice, feeGldAmount, reserveCostUsdMicros, currencyCode: "GLD", usdCostMicros, displayedValueUsdMicros: safeDisplayedValue, safetyMarginBps: config.paidRewardSafetyMarginBps, economyHealth: state?.health ?? "CRITICAL", availableCodes, eligible: !controls.paidRewardsPaused && !blockedByHealth && availableCodes > 0, reason }
  }
  private playerPaidReward(row: any) { const gldPrice = row.gldPrice ?? null; const refunded = row.gldRefundedAmount ?? 0n; return this.serialize({ id: row.id, status: row.status, requestKey: row.requestKey, inventoryItemId: row.inventoryItemId, message: row.message, adminNote: row.adminNote, gldPrice, gldUnitPriceUsdMicros: row.gldUnitPriceUsdMicros ?? null, reserveCostUsdMicros: row.reserveCostUsdMicros ?? null, gldFeeAmount: row.gldFeeAmount ?? null, gldRefundedAmount: refunded, gldStatus: row.status === "REFUSED" && refunded > 0n ? "REFUNDED" : row.status === "FULFILLED" ? "SPENT" : gldPrice !== null ? "RESERVED" : "LEGACY", requestedAt: row.requestedAt, decidedAt: row.decidedAt, asset: row.assetDefinition ? { id: row.assetDefinition.id, key: row.assetDefinition.key, name: row.assetDefinition.name, imageUrl: row.assetDefinition.imageUrl } : undefined, variation: row.assetVariation ? { id: row.assetVariation.id, key: row.assetVariation.key, name: row.assetVariation.name } : null, redeemCode: row.redeemCode ? { id: row.redeemCode.id, code: row.redeemCode.code, status: row.redeemCode.status, assignedAt: row.redeemCode.assignedAt } : null }) }
  private adminPaidReward(row: any) { return this.serialize({ ...this.playerPaidReward(row), user: row.user, adminNote: row.adminNote, decidedBy: row.decidedBy, inventoryItemId: row.inventoryItemId, redeemCode: row.redeemCode ? { id: row.redeemCode.id, code: row.redeemCode.code, status: row.redeemCode.status, assignedAt: row.redeemCode.assignedAt } : null }) }
  private gldToUsdMicros(gldAmount: bigint, unitPriceUsdMicros: bigint) { return (gldAmount * unitPriceUsdMicros + 1_000_000n - 1n) / 1_000_000n }
}
