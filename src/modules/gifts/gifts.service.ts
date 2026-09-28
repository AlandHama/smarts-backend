import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { SendGiftTransaction } from "./transactions/send-gift-transaction"
import { SendGiftDto } from "./dtos/gift.dto"

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendGiftTransaction: SendGiftTransaction,
  ) {}

  /** Public social-gift definitions. Commerce catalogs are deliberately not read here. */
  async listCatalog() {
    const definitions = await this.prisma.socialGiftDefinition.findMany({
      where: { active: true, priceGld: { gt: 0n } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
    return this.serialize(definitions.map((gift) => ({
      id: gift.id,
      key: gift.key,
      name: gift.name,
      icon: gift.icon,
      description: gift.description,
      imageUrl: gift.imageUrl,
      category: "Social gifts",
      gldPrice: gift.priceGld,
      chargedAmount: gift.priceGld,
      giftFeeAmount: 0n,
      giftFeeBps: 0,
      recipientRewardBps: gift.recipientRewardBps,
      recipientRewardPercent: gift.recipientRewardBps / 100,
      recipientAmount: new Prisma.Decimal(gift.priceGld.toString())
        .mul(gift.recipientRewardBps)
        .div(10_000)
        .toDecimalPlaces(6),
    })))
  }

  send(senderUserId: string, dto: SendGiftDto) {
    return this.sendGiftTransaction.run({ senderUserId, dto })
  }

  async listForPlayer(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({
      where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
        recipient: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
        socialGiftDefinition: true,
        catalogItem: { select: { key: true, name: true, imageUrl: true, assetDefinition: { select: { key: true, imageUrl: true } } } },
      },
    })
    return this.serialize(rows.map((row) => ({
      ...row,
      direction: row.senderUserId === targetUserId ? "SENT" : "RECEIVED",
      gift: this.giftInfo(row),
    })))
  }

  async stats(viewerUserId: string, targetUserId: string) {
    await this.assertCanView(viewerUserId, targetUserId)
    const rows = await this.prisma.playerGift.findMany({
      where: { OR: [{ senderUserId: targetUserId }, { recipientUserId: targetUserId }] },
      select: {
        senderUserId: true,
        recipientUserId: true,
        gldPrice: true,
        chargedAmount: true,
        burnedAmountDecimal: true,
        recipientAmount: true,
        socialGiftDefinition: { select: { key: true, name: true, icon: true, imageUrl: true } },
        catalogItem: { select: { key: true, name: true, imageUrl: true, assetDefinition: { select: { imageUrl: true } } } },
        sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
    })
    const sent = rows.filter((row) => row.senderUserId === targetUserId)
    const received = rows.filter((row) => row.recipientUserId === targetUserId)
    const byGift = new Map<string, { key: string; name: string; icon: string | null; imageUrl: string | null; count: number; gldValue: bigint; gldReward: Prisma.Decimal }>()
    for (const row of received) {
      const gift = this.giftInfo(row)
      const current = byGift.get(gift.key) ?? { key: gift.key, name: gift.name, icon: gift.icon, imageUrl: gift.imageUrl, count: 0, gldValue: 0n, gldReward: new Prisma.Decimal(0) }
      current.count += 1
      current.gldValue += row.gldPrice
      current.gldReward = current.gldReward.add(row.recipientAmount)
      byGift.set(gift.key, current)
    }
    const supporters = new Map<string, { userId: string; name: string; points: bigint }>()
    for (const row of received) {
      const current = supporters.get(row.senderUserId) ?? { userId: row.sender.id, name: row.sender.profile?.displayName ?? row.sender.username, points: 0n }
      current.points += row.gldPrice
      supporters.set(row.senderUserId, current)
    }
    const topSupporter = [...supporters.values()].sort((a, b) => b.points > a.points ? 1 : b.points < a.points ? -1 : 0)[0] ?? null
    return this.serialize({
      sent: sent.length,
      received: received.length,
      totalGldSent: sent.reduce((sum, row) => sum + (row.chargedAmount > 0n ? row.chargedAmount : row.gldPrice), 0n),
      totalGldReceived: received.reduce((sum, row) => sum.add(row.recipientAmount), new Prisma.Decimal(0)),
      totalGiftValueReceived: received.reduce((sum, row) => sum + row.gldPrice, 0n),
      totalGldBurned: sent.reduce((sum, row) => sum.add(row.burnedAmountDecimal), new Prisma.Decimal(0)),
      receivedByGift: [...byGift.values()].sort((a, b) => b.count - a.count),
      topSupporter,
    })
  }

  private giftInfo(row: any) {
    if (row.socialGiftDefinition) {
      return { id: row.socialGiftDefinition.id, key: row.socialGiftDefinition.key, name: row.socialGiftDefinition.name, icon: row.socialGiftDefinition.icon, imageUrl: row.socialGiftDefinition.imageUrl }
    }
    const item = row.catalogItem
    return { id: item?.id ?? null, key: item?.key ?? "legacy-gift", name: item?.name ?? "Gift", icon: null, imageUrl: item?.imageUrl ?? item?.assetDefinition?.imageUrl ?? null }
  }

  private async assertCanView(viewerUserId: string, targetUserId: string) {
    if (viewerUserId === targetUserId) return
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, profile: { select: { isPublic: true } } } })
    if (!target) throw new NotFoundException("Player not found")
    if (target.profile?.isPublic) return
    const friendship = await this.prisma.friendship.findFirst({ where: { OR: [{ userId: viewerUserId, friendId: targetUserId }, { userId: targetUserId, friendId: viewerUserId }] }, select: { id: true } })
    if (!friendship) throw new ForbiddenException("You cannot view this player's gifts")
  }

  private serialize(value: unknown): any {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item))
  }
}
