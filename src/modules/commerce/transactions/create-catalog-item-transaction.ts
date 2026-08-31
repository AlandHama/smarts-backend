import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CatalogPriceInput, CatalogRewardInput } from "../dtos"

export type CreateCatalogItemInput = {
  catalogId: string
  key: string
  name: string
  description?: string
  assetKey?: string
  imageUrl?: string
  imageAlt?: string
  imageUrls?: string[]
  purchasable?: boolean
  active?: boolean
  startsAt?: string
  endsAt?: string
  prices: CatalogPriceInput[]
  rewards?: CatalogRewardInput[]
  metadata?: Record<string, unknown>
}

@Injectable()
export class CreateCatalogItemTransaction extends PrismaTransaction<CreateCatalogItemInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: CreateCatalogItemInput, transaction: Prisma.TransactionClient) {
    if (!input.prices?.length) throw new BadRequestException("At least one catalog price is required")
    const catalog = await transaction.catalog.findUnique({ where: { id: input.catalogId } })
    if (!catalog) throw new NotFoundException("Catalog not found")
    const asset = input.assetKey ? await transaction.assetDefinition.findUnique({ where: { key: input.assetKey.trim().toLowerCase() } }) : null
    if (input.assetKey && !asset) throw new NotFoundException("Asset definition not found")
    const prices = await this.resolvePrices(input.prices, transaction)
    const rewards = await this.resolveRewards(input.rewards ?? [], transaction)
    try {
      return await transaction.catalogItem.create({
        data: {
          catalogId: catalog.id, key: input.key.trim().toLowerCase(), name: input.name.trim(), description: input.description,
          assetDefinitionId: asset?.id, imageUrl: input.imageUrl, imageAlt: input.imageAlt, imageUrls: input.imageUrls as Prisma.InputJsonValue | undefined,
          purchasable: input.purchasable ?? true, active: input.active ?? true, startsAt: this.date(input.startsAt), endsAt: this.date(input.endsAt), metadata: input.metadata as Prisma.InputJsonValue | undefined,
          prices: { create: prices }, rewards: { create: rewards },
        }, include: this.include(),
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("A catalog item with this key already exists in this catalog")
      throw error
    }
  }

  private async resolvePrices(items: CatalogPriceInput[], transaction: Prisma.TransactionClient) {
    return Promise.all(items.map(async (price) => {
      if (!/^\d+$/.test(String(price.amount)) || BigInt(price.amount) <= 0n) throw new BadRequestException("Catalog prices must be positive integer minor units")
      const currency = await transaction.currencyDefinition.findUnique({ where: { code: price.currencyCode.trim().toUpperCase() } })
      if (!currency || !currency.active) throw new BadRequestException(`Currency ${price.currencyCode} is not active`)
      return { currencyId: currency.id, amount: BigInt(price.amount), active: price.active ?? true }
    }))
  }

  private async resolveRewards(items: CatalogRewardInput[], transaction: Prisma.TransactionClient) {
    return Promise.all(items.map(async (reward) => {
      const data: any = { rewardType: reward.rewardType, targetKey: reward.targetKey, amount: reward.amount === undefined ? undefined : BigInt(reward.amount), quantity: reward.quantity ?? 1, sortOrder: reward.sortOrder ?? 0, metadata: reward.metadata as Prisma.InputJsonValue | undefined }
      if (data.quantity < 1 || data.quantity > 1000000) throw new BadRequestException("Reward quantity is out of range")
      if (data.amount !== undefined && data.amount < 0n) throw new BadRequestException("Reward amount cannot be negative")
      if (reward.assetKey) {
        const asset = await transaction.assetDefinition.findUnique({ where: { key: reward.assetKey.trim().toLowerCase() } })
        if (!asset) throw new NotFoundException(`Asset ${reward.assetKey} not found`)
        data.assetDefinitionId = asset.id
        if (reward.variationKey) {
          const variation = await transaction.assetVariation.findUnique({ where: { assetDefinitionId_key: { assetDefinitionId: asset.id, key: reward.variationKey.trim().toLowerCase() } } })
          if (!variation) throw new NotFoundException(`Variation ${reward.variationKey} not found`)
          data.assetVariationId = variation.id
        }
      }
      if (reward.currencyCode) {
        const currency = await transaction.currencyDefinition.findUnique({ where: { code: reward.currencyCode.trim().toUpperCase() } })
        if (!currency || !currency.active) throw new BadRequestException(`Currency ${reward.currencyCode} is not active`)
        data.currencyId = currency.id
      }
      if (reward.progressionKey) {
        const progression = await transaction.progressionDefinition.findUnique({ where: { key: reward.progressionKey.trim().toLowerCase() } })
        if (!progression || !progression.active) throw new BadRequestException(`Progression ${reward.progressionKey} is not active`)
        data.progressionDefinitionId = progression.id
      }
      return data
    }))
  }

  private date(value?: string) { return value ? new Date(value) : undefined }
  private include() { return { catalog: true, assetDefinition: true, prices: { include: { currency: true } }, rewards: { orderBy: { sortOrder: "asc" as const }, include: { assetDefinition: true, assetVariation: true, currency: true, progressionDefinition: true } } } }
}
