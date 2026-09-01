import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { AcceptFriendInviteTransaction } from "./transactions/accept-friend-invite-transaction"
import { CancelTicketTransaction } from "./transactions/cancel-ticket-transaction"
import { CreateFriendInviteTransaction } from "./transactions/create-friend-invite-transaction"
import { EnqueuePlayerTransaction } from "./transactions/enqueue-player-transaction"
import { HeartbeatTicketTransaction } from "./transactions/heartbeat-ticket-transaction"
import { RespondFriendInviteTransaction } from "./transactions/respond-friend-invite-transaction"
import { EnqueuePlayerDto, CreateFriendInviteDto } from "./dtos"

@Injectable()
export class MatchmakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enqueueTransaction: EnqueuePlayerTransaction,
    private readonly heartbeatTransaction: HeartbeatTicketTransaction,
    private readonly cancelTransaction: CancelTicketTransaction,
    private readonly createInviteTransaction: CreateFriendInviteTransaction,
    private readonly acceptInviteTransaction: AcceptFriendInviteTransaction,
    private readonly respondInviteTransaction: RespondFriendInviteTransaction,
  ) {}

  enqueue(userId: string, dto: EnqueuePlayerDto) { return this.enqueueTransaction.run({ userId, dto }).then((value) => this.serialize(value)) }
  heartbeat(userId: string, ticketId: string) { return this.heartbeatTransaction.run({ userId, ticketId }).then((value) => this.serialize(value)) }
  cancel(userId: string, ticketId: string) { return this.cancelTransaction.run({ userId, ticketId }).then((value) => this.serialize(value)) }
  createInvite(userId: string, dto: CreateFriendInviteDto) { return this.createInviteTransaction.run({ userId, dto }).then((value) => this.serialize(value)) }
  acceptInvite(userId: string, inviteId: string) { return this.acceptInviteTransaction.run({ userId, inviteId }).then((value) => this.serialize(value)) }
  declineInvite(userId: string, inviteId: string) { return this.respondInviteTransaction.run({ userId, inviteId, response: "DECLINED" }).then((value) => this.serialize(value)) }
  cancelInvite(userId: string, inviteId: string) { return this.respondInviteTransaction.run({ userId, inviteId, response: "CANCELED" }).then((value) => this.serialize(value)) }

  async status(userId: string) {
    const ticket = await this.prisma.matchmakingTicket.findFirst({ where: { userId, status: { in: ["SEARCHING", "MATCHED"] } }, orderBy: { createdAt: "desc" }, include: { gameDefinition: { select: { key: true, name: true } }, match: { select: { id: true, status: true, mode: true, startedAt: true, createdAt: true, participants: { select: { id: true, userId: true, participantType: true, result: true } } } } } })
    return this.serialize({ ticket, match: ticket?.match ?? null })
  }

  async invites(userId: string) {
    const [incoming, outgoing] = await this.prisma.$transaction([
      this.prisma.matchmakingInvite.findMany({ where: { inviteeId: userId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 50, include: { inviter: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } }, gameDefinition: { select: { key: true, name: true } } } }),
      this.prisma.matchmakingInvite.findMany({ where: { inviterId: userId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 50, include: { invitee: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } }, gameDefinition: { select: { key: true, name: true } } } }),
    ])
    return this.serialize({ incoming, outgoing })
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T }
}
