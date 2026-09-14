import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../prisma.service"
import { SendGiftTransaction } from "./transactions/send-gift-transaction"
import { SendGiftDto } from "./dtos/gift.dto"
import { CommerceService } from "../commerce/commerce.service"

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendGiftTransaction: SendGiftTransaction,
    private readonly commerceService: CommerceService,
  ) {}

  async listCatalog(catalogKey = "main") {
    // Reuse the public Commerce pricing path so AUTO GLD prices follow the
    // current GLD value instead of becoming stale in the gift store.
    const catalog = await this.commerceService.listCatalog(catalogKey)
    const items = Array.isArray((catalog as any).items) ? (catalog as any).items : []
    return items
      .map((item: any) => ({ item, price: item.prices?.find((price: any) => price.currency?.code === "GLD" && price.currency?.active) ?? null }))
      .filter(({ item, price }: { item: any; price: any }) => this.isGiftItem(item.metadata) && item.assetDefinition && price && this.positiveAmount(price.amount))
      .map(({ item, price }: { item: any; price: any }) => {
        const gldPrice = BigInt(String(price.amount))
        const giftFeeBps = this.giftFeeBps(item.metadata)
        const giftFeeAmount = (gldPrice * BigInt(giftFeeBps) + 9_999n) / 10_000n
        return { id: item.id, key: item.key, name: item.name, description: item.description, category: this.metadataString(item.metadata, "category") ?? "Popular", imageUrl: item.imageUrl ?? item.assetDefinition.imageUrl ?? null, assetKey: item.assetDefinition.key, gldPrice: gldPrice.toString(), giftFeeAmount: giftFeeAmount.toString(), chargedAmount: (gldPrice + giftFeeAmount).toString(), giftFeeBps }
      })
  }

  send(senderUserId: string, dto: SendGiftDto) { return this.sendGiftTransaction.run({ senderUserId, dto }) }

  async listForPlayer(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({ where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] }, orderBy: { createdAt: "desc" }, take: 200, include: { sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } }, recipient: { select: { id: true, username: true, profile: { select: { displayName: true } } } }, catalogItem: { select: { key: true, name: true, imageUrl: true, assetDefinition: { select: { key: true, imageUrl: true } } } } } })
    return this.serialize(rows.map((row) => ({ ...row, direction: row.senderUserId === targetUserId ? "SENT" : "RECEIVED", catalogItem: { ...row.catalogItem, imageUrl: row.catalogItem.imageUrl ?? row.catalogItem.assetDefinition?.imageUrl ?? null } })))
  }

  async stats(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({ where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] }, select: { senderUserId: true, recipientUserId: true, gldPrice: true, chargedAmount: true, burnedAmount: true } })
    return this.serialize({ sent: rows.filter((row) => row.senderUserId === targetUserId).length, received: rows.filter((row) => row.recipientUserId === targetUserId).length, totalGldSent: rows.filter((row) => row.senderUserId === targetUserId).reduce((sum, row) => sum + (row.chargedAmount > 0n ? row.chargedAmount : row.gldPrice), 0n), totalGldReceived: rows.filter((row) => row.recipientUserId === targetUserId).reduce((sum, row) => sum + row.gldPrice, 0n), totalGldBurned: rows.filter((row) => row.senderUserId === targetUserId).reduce((sum, row) => sum + row.burnedAmount, 0n) })
  }

  private async assertCanView(viewerUserId: string, targetUserId: string) {
    if (viewerUserId === targetUserId) return
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, profile: { select: { isPublic: true } } } })
    if (!target) throw new NotFoundException("Player not found")
    if (target.profile?.isPublic) return
    const friendship = await this.prisma.friendship.findFirst({ where: { OR: [{ userId: viewerUserId, friendId: targetUserId }, { userId: targetUserId, friendId: viewerUserId }] }, select: { id: true } })
    if (!friendship) throw new ForbiddenException("You cannot view this player's gifts")
  }

  private isGiftItem(metadata: any) { return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata.gift === true || metadata.isGift === true || metadata.kind === "GIFT" || metadata.type === "GIFT")) }
  private metadataString(metadata: any, key: string) { return metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata[key] === "string" ? metadata[key].trim() || null : null }
  private positiveAmount(value: unknown) { try { return BigInt(String(value)) > 0n } catch { return false } }
  private giftFeeBps(metadata: any) {
    const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.giftFeePercent : 0
    const percent = typeof raw === "number" && Number.isInteger(raw) ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0
    return Math.min(Math.max(percent, 0), 100) * 100
  }
  private serialize(value: unknown): any { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
