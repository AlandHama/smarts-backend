import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash, randomBytes } from "node:crypto"
import { Prisma, ProgressionEventSourceType, WalletTransactionSourceType } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../economy/transactions/debit-wallet-transaction"
import { AwardProgressionPointsTransaction } from "../progression/transactions/award-progression-points-transaction"
import { GrantInventoryItemTransaction } from "../commerce/transactions/grant-inventory-item-transaction"
import { CreateSpinningWheelDto, UpdateSpinningWheelDto } from "./dtos"

type Segment = { type: "GLD" | "XP" | "SKIP_GEM"; amount: string; weight: number }

@Injectable()
export class SpinningWheelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly debitWallet: DebitWalletTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly awardProgression: AwardProgressionPointsTransaction,
    private readonly grantInventory: GrantInventoryItemTransaction,
  ) {}

  async listForPlayer(userId: string) {
    const wheels = await this.prisma.spinningWheel.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, include: { inventories: { where: { userId }, select: { quantity: true, totalSpins: true } } } })
    await this.ensureDailyGrants(userId, wheels)
    const refreshed = await this.prisma.spinningWheel.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, include: { inventories: { where: { userId }, select: { quantity: true, totalSpins: true } } } })
    return refreshed.map((wheel) => this.serializeWheel(wheel))
  }

  async getPlayerHistory(userId: string) {
    const rows = await this.prisma.spinningWheelSpin.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50, include: { wheel: { select: { key: true, name: true } } } })
    return rows.map((row) => ({ id: row.id, wheelKey: row.wheel.key, wheelName: row.wheel.name, rewardType: row.rewardType, rewardAmount: row.rewardAmount.toString(), source: row.source, status: row.status, createdAt: row.createdAt, claimedAt: row.claimedAt }))
  }

  async purchase(userId: string, wheelKey: string, quantity = 1) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new BadRequestException("Quantity must be between 1 and 100")
    const wheel = await this.prisma.spinningWheel.findUnique({ where: { key: wheelKey }, select: { id: true, key: true, name: true, active: true, purchasePriceGld: true } })
    if (!wheel || !wheel.active) throw new NotFoundException("Spinning wheel not found")
    if (wheel.purchasePriceGld <= 0n) throw new BadRequestException("This wheel is not purchasable")
    const sourceId = `spinning-wheel-purchase:${wheel.id}:${Date.now()}:${randomBytes(5).toString("hex")}`
    return this.prisma.$transaction(async (tx) => {
      await this.debitWallet.runWithinTransaction({ userId, currencyCode: "GLD", amount: wheel.purchasePriceGld * BigInt(quantity), sourceId, sourceType: WalletTransactionSourceType.SPINNING_WHEEL, metadata: { wheelKey: wheel.key, quantity, reason: "SPINNING_WHEEL_PURCHASE" } }, tx)
      const inventory = await tx.spinningWheelInventory.upsert({ where: { userId_wheelId: { userId, wheelId: wheel.id } }, create: { userId, wheelId: wheel.id, quantity }, update: { quantity: { increment: quantity } } })
      return { wheelKey: wheel.key, quantity: inventory.quantity, chargedGld: (wheel.purchasePriceGld * BigInt(quantity)).toString() }
    })
  }

  async spin(userId: string, wheelKey?: string) {
    const wheel = wheelKey
      ? await this.prisma.spinningWheel.findFirst({ where: { key: wheelKey, active: true } })
      : await this.prisma.spinningWheel.findFirst({ where: { active: true, inventories: { some: { userId, quantity: { gt: 0 } } } }, orderBy: { createdAt: "asc" } })
    if (!wheel) throw new NotFoundException("No spinning wheel is available")
    const segments = this.parseSegments(wheel.segments)
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SpinningWheelInventory" WHERE "userId" = ${userId}::uuid AND "wheelId" = ${wheel.id}::uuid FOR UPDATE`
      const inventory = await tx.spinningWheelInventory.findUnique({ where: { userId_wheelId: { userId, wheelId: wheel.id } } })
      if (!inventory || inventory.quantity < 1) throw new BadRequestException("You do not have a wheel to spin")
      const segment = this.pickSegment(segments)
      const source = "INVENTORY"
      const claimToken = segment.type === "GLD" ? randomBytes(32).toString("hex") : null
      const spin = await tx.spinningWheelSpin.create({ data: { userId, wheelId: wheel.id, rewardType: segment.type, rewardAmount: BigInt(segment.amount), source, status: segment.type === "GLD" ? "PENDING_AD" : "GRANTED", claimTokenHash: claimToken ? this.hash(claimToken) : null, expiresAt: claimToken ? new Date(Date.now() + 10 * 60 * 1000) : null } })
      await tx.spinningWheelInventory.update({ where: { id: inventory.id }, data: { quantity: { decrement: 1 }, totalSpins: { increment: 1 } } })
      if (segment.type === "XP") await this.awardProgression.runWithinTransaction({ userId, progressionKey: "main", amount: BigInt(segment.amount), sourceId: `spinning-wheel:${spin.id}`, sourceType: ProgressionEventSourceType.SYSTEM, metadata: { wheelId: wheel.id, spinId: spin.id } }, tx)
      if (segment.type === "SKIP_GEM") await this.grantInventory.runWithinTransaction({ userId, assetKey: "consumable:skip_gem", quantity: Number(segment.amount), source: "SYSTEM", sourceId: `spinning-wheel:${spin.id}`, metadata: { wheelId: wheel.id, spinId: spin.id } }, tx)
      return { spin, segment, claimToken }
    })
    return { spinId: result.spin.id, wheelKey: wheel.key, rewardType: result.segment.type, rewardAmount: result.segment.amount, requiresAd: result.segment.type === "GLD", claimToken: result.claimToken, status: result.spin.status }
  }

  async claimGld(userId: string, spinId: string, claimToken: string) {
    const hash = this.hash(claimToken)
    const spin = await this.prisma.spinningWheelSpin.findFirst({ where: { id: spinId, userId, claimTokenHash: hash } })
    if (!spin || spin.status !== "PENDING_AD") throw new NotFoundException("Wheel reward is not claimable")
    if (spin.expiresAt && spin.expiresAt < new Date()) throw new BadRequestException("Wheel reward expired")
    const sourceId = `spinning-wheel-spin:${spin.id}`
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.spinningWheelSpin.findUniqueOrThrow({ where: { id: spin.id } })
      if (locked.status !== "PENDING_AD") throw new ConflictException("Wheel reward was already claimed")
      const wallet = await this.creditWallet.runWithinTransaction({ userId, currencyCode: "GLD", amount: locked.rewardAmount, sourceId, sourceType: WalletTransactionSourceType.SPINNING_WHEEL, metadata: { spinId: locked.id, wheelId: locked.wheelId, reason: "SPINNING_WHEEL_AD_REWARD", playerLabel: "Lucky spin reward" } }, tx)
      await tx.spinningWheelSpin.update({ where: { id: locked.id }, data: { status: "CLAIMED", claimedAt: new Date() } })
      return { spinId: locked.id, rewardType: locked.rewardType, rewardAmount: locked.rewardAmount.toString(), wallet }
    })
  }

  async grantTrigger(userId: string, trigger: "DAILY" | "LEVEL_UP" | "RANK_UP" | "MATCH_WIN", sourceId: string) {
    const wheels = await this.prisma.spinningWheel.findMany({ where: { active: true } })
    await this.prisma.$transaction((tx) => this.grantTriggerWithinTransaction(tx, userId, trigger, sourceId, wheels))
  }

  async grantTriggerWithinTransaction(tx: Prisma.TransactionClient, userId: string, trigger: "DAILY" | "LEVEL_UP" | "RANK_UP" | "MATCH_WIN", sourceId: string, wheels?: any[]) {
    const definitions = wheels ?? await tx.spinningWheel.findMany({ where: { active: true } })
    for (const wheel of definitions) {
      const quantity = trigger === "DAILY" && wheel.dailyEnabled ? wheel.dailyQuantity : trigger === "LEVEL_UP" && wheel.levelUpEnabled ? wheel.levelUpQuantity : trigger === "RANK_UP" && wheel.rankUpEnabled ? wheel.rankUpQuantity : trigger === "MATCH_WIN" && wheel.matchWinEnabled ? wheel.matchWinQuantity : 0
      if (!quantity) continue
      try { await tx.spinningWheelGrant.create({ data: { userId, wheelId: wheel.id, trigger, sourceId, quantity } }) }
      catch (error) { if ((error as any)?.code === "P2002") continue; throw error }
      await tx.spinningWheelInventory.upsert({ where: { userId_wheelId: { userId, wheelId: wheel.id } }, create: { userId, wheelId: wheel.id, quantity }, update: { quantity: { increment: quantity } } })
    }
  }

  async adminList() { return (await this.prisma.spinningWheel.findMany({ orderBy: { createdAt: "asc" } })).map((wheel) => this.serializeWheel(wheel)) }

  async adminCreate(dto: CreateSpinningWheelDto) { const data = this.normalizeInput(dto); return this.prisma.spinningWheel.create({ data }).then((wheel) => this.serializeWheel(wheel)) }

  async adminUpdate(id: string, dto: UpdateSpinningWheelDto) { const data = this.normalizeInput(dto); return this.prisma.spinningWheel.update({ where: { id }, data }).then((wheel) => this.serializeWheel(wheel)) }

  async adminArchive(id: string) { return this.prisma.spinningWheel.update({ where: { id }, data: { active: false } }).then((wheel) => this.serializeWheel(wheel)) }

  private async ensureDailyGrants(userId: string, wheels: any[]) {
    const dateKey = new Date().toISOString().slice(0, 10)
    await this.grantDailyWithKey(userId, dateKey, wheels)
  }

  private async grantDailyWithKey(userId: string, sourceId: string, wheels: any[]) {
    const eligible = wheels.filter((wheel) => wheel.active && wheel.dailyEnabled && wheel.dailyQuantity > 0)
    if (!eligible.length) return
    await this.prisma.$transaction(async (tx) => {
      for (const wheel of eligible) {
        try { await tx.spinningWheelGrant.create({ data: { userId, wheelId: wheel.id, trigger: "DAILY", sourceId, quantity: wheel.dailyQuantity } }) }
        catch (error) { if ((error as any)?.code === "P2002") continue; throw error }
        await tx.spinningWheelInventory.upsert({ where: { userId_wheelId: { userId, wheelId: wheel.id } }, create: { userId, wheelId: wheel.id, quantity: wheel.dailyQuantity }, update: { quantity: { increment: wheel.dailyQuantity } } })
      }
    })
  }

  private normalizeInput(dto: CreateSpinningWheelDto) {
    const segments = this.parseSegments(dto.segments)
    return { key: dto.key.trim().toLowerCase(), name: dto.name.trim(), description: dto.description?.trim() || null, themeKey: dto.themeKey?.trim() || "royal_crown", active: dto.active ?? true, purchasePriceGld: BigInt(dto.purchasePriceGld), dailyEnabled: dto.dailyEnabled ?? true, dailyQuantity: dto.dailyQuantity ?? 1, levelUpEnabled: dto.levelUpEnabled ?? false, levelUpQuantity: dto.levelUpQuantity ?? 1, rankUpEnabled: dto.rankUpEnabled ?? false, rankUpQuantity: dto.rankUpQuantity ?? 1, matchWinEnabled: dto.matchWinEnabled ?? false, matchWinQuantity: dto.matchWinQuantity ?? 1, segments: segments as unknown as Prisma.InputJsonValue }
  }

  private parseSegments(input: unknown): Segment[] {
    if (!Array.isArray(input) || input.length < 2 || input.length > 24) throw new BadRequestException("A wheel must have between 2 and 24 segments")
    const segments = input.map((raw: any) => { const type = String(raw?.type ?? "").toUpperCase() as Segment["type"]; const amount = String(raw?.amount ?? ""); const weight = Number(raw?.weight ?? 1); if (!["GLD", "XP", "SKIP_GEM"].includes(type) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n || !Number.isInteger(weight) || weight < 1) throw new BadRequestException("Wheel segments must use GLD, XP, or SKIP_GEM with positive amounts") ; return { type, amount, weight } })
    return segments
  }

  private pickSegment(segments: Segment[]) { const total = segments.reduce((sum, item) => sum + item.weight, 0); let cursor = Math.floor(Math.random() * total); for (const segment of segments) { cursor -= segment.weight; if (cursor < 0) return segment } return segments[segments.length - 1] }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex") }
  private serializeWheel(wheel: any) { const inventory = wheel.inventories?.[0]; return { id: wheel.id, key: wheel.key, name: wheel.name, description: wheel.description, themeKey: wheel.themeKey, active: wheel.active, purchasePriceGld: wheel.purchasePriceGld.toString(), dailyEnabled: wheel.dailyEnabled, dailyQuantity: wheel.dailyQuantity, levelUpEnabled: wheel.levelUpEnabled, levelUpQuantity: wheel.levelUpQuantity, rankUpEnabled: wheel.rankUpEnabled, rankUpQuantity: wheel.rankUpQuantity, matchWinEnabled: wheel.matchWinEnabled, matchWinQuantity: wheel.matchWinQuantity, segments: wheel.segments, inventory: { quantity: inventory?.quantity ?? 0, totalSpins: inventory?.totalSpins ?? 0 } } }
}
