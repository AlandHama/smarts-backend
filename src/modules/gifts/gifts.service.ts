import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../prisma.service"
import { SendGiftTransaction } from "./transactions/send-gift-transaction"
import { SendGiftDto } from "./dtos/gift.dto"

@Injectable()
export class GiftsService {
  constructor(private readonly prisma: PrismaService, private readonly sendGiftTransaction: SendGiftTransaction) {}

  async listCatalog(catalogKey = "main") {
    const now = new Date()
    const items = await this.prisma.catalogItem.findMany({ where: { active: true, purchasable: true, catalog: { key: catalogKey.trim().toLowerCase(), active: true }, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] }, orderBy: { name: "asc" }, take: 500, include: { catalog: true, assetDefinition: { select: { key: true, name: true, imageUrl: true } }, prices: { where: { active: true }, include: { currency: { select: { code: true, active: true } } } } } })
    return this.serialize(items.map((item) => ({ item, price: item.prices.find((price) => price.currency.code === "GLD" && price.currency.active)?.amount ?? null })).filter(({ item, price }) => this.isGiftItem(item.metadata) && price !== null && price > 0n).map(({ item, price }) => ({ id: item.id, key: item.key, name: item.name, description: item.description, category: this.metadataString(item.metadata, "category") ?? "Popular", imageUrl: item.imageUrl ?? item.assetDefinition?.imageUrl ?? null, assetKey: item.assetDefinition?.key ?? null, gldPrice: price })))
  }

  send(senderUserId: string, dto: SendGiftDto) { return this.sendGiftTransaction.run({ senderUserId, dto }) }

  async listForPlayer(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({ where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] }, orderBy: { createdAt: "desc" }, take: 200, include: { sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } }, recipient: { select: { id: true, username: true, profile: { select: { displayName: true } } } }, catalogItem: { select: { key: true, name: true, imageUrl: true, assetDefinition: { select: { key: true, imageUrl: true } } } } } })
    return this.serialize(rows.map((row) => ({ ...row, direction: row.senderUserId === targetUserId ? "SENT" : "RECEIVED", catalogItem: { ...row.catalogItem, imageUrl: row.catalogItem.imageUrl ?? row.catalogItem.assetDefinition?.imageUrl ?? null } })))
  }

  async stats(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({ where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] }, select: { senderUserId: true, recipientUserId: true, gldPrice: true, burnedAmount: true } })
    return this.serialize({ sent: rows.filter((row) => row.senderUserId === targetUserId).length, received: rows.filter((row) => row.recipientUserId === targetUserId).length, totalGldSent: rows.filter((row) => row.senderUserId === targetUserId).reduce((sum, row) => sum + row.gldPrice, 0n), totalGldReceived: rows.filter((row) => row.recipientUserId === targetUserId).reduce((sum, row) => sum + row.gldPrice, 0n), totalGldBurned: rows.filter((row) => row.senderUserId === targetUserId).reduce((sum, row) => sum + row.burnedAmount, 0n) })
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
  private serialize(value: unknown): any { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) }
}
