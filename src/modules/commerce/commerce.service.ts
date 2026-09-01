import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, PurchaseStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateAssetDto, CreateCatalogDto, CreateCatalogItemDto, InventoryMutationDto, InventoryQueryDto, UpdateAssetDto, UpdateCatalogDto, UpdateCatalogItemDto } from "./dtos"
import { CreateCatalogItemTransaction } from "./transactions/create-catalog-item-transaction"
import { CreatePurchaseTransaction } from "./transactions/create-purchase-transaction"
import { GrantInventoryItemTransaction } from "./transactions/grant-inventory-item-transaction"
import { RevokeInventoryItemTransaction } from "./transactions/revoke-inventory-item-transaction"
import { StorageService } from "../storage/storage.service"

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createCatalogItemTransaction: CreateCatalogItemTransaction,
    private readonly createPurchaseTransaction: CreatePurchaseTransaction,
    private readonly grantInventoryTransaction: GrantInventoryItemTransaction,
    private readonly revokeInventoryTransaction: RevokeInventoryItemTransaction,
    private readonly storageService: StorageService,
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

  private itemInclude() { return { assetDefinition: { select: { id: true, key: true, name: true, imageUrl: true } }, prices: { where: { active: true }, include: { currency: { select: { code: true, name: true, precision: true, active: true } } } }, rewards: { orderBy: { sortOrder: "asc" as const }, include: { assetDefinition: { select: { key: true, name: true, imageUrl: true } }, assetVariation: { select: { key: true, name: true, imageUrl: true } }, currency: { select: { code: true, name: true } }, progressionDefinition: { select: { key: true, name: true } } } } } }
  private date(value?: string) { return value ? new Date(value) : undefined }
  private assetKey(value: string) { return value.trim().toLowerCase() }
  private isAvailable(startsAt: Date | null, endsAt: Date | null) { const now = Date.now(); return (!startsAt || startsAt.getTime() <= now) && (!endsAt || endsAt.getTime() > now) }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
