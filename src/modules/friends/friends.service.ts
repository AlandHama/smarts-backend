import { ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { FriendRequestStatus, Prisma, UserStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { AdminFriendsQueryDto, FriendsQueryDto, PlayerLookupQueryDto } from "./dtos/friends.dto"
import { AcceptFriendRequestTransaction } from "./transactions/accept-friend-request-transaction"
import { BlockPlayerTransaction } from "./transactions/block-player-transaction"
import { CreateFriendRequestTransaction } from "./transactions/create-friend-request-transaction"
import { CreateFriendshipTransaction } from "./transactions/create-friendship-transaction"
import { HeartbeatPresenceTransaction } from "./transactions/heartbeat-presence-transaction"
import { RemoveFriendshipTransaction } from "./transactions/remove-friendship-transaction"
import { RespondFriendRequestTransaction } from "./transactions/respond-friend-request-transaction"
import { UnblockPlayerTransaction } from "./transactions/unblock-player-transaction"

const PRESENCE_WINDOW_SECONDS = 5 * 60

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createFriendRequestTransaction: CreateFriendRequestTransaction,
    private readonly createFriendshipTransaction: CreateFriendshipTransaction,
    private readonly acceptFriendRequestTransaction: AcceptFriendRequestTransaction,
    private readonly respondFriendRequestTransaction: RespondFriendRequestTransaction,
    private readonly removeFriendshipTransaction: RemoveFriendshipTransaction,
    private readonly blockPlayerTransaction: BlockPlayerTransaction,
    private readonly unblockPlayerTransaction: UnblockPlayerTransaction,
    private readonly heartbeatPresenceTransaction: HeartbeatPresenceTransaction,
  ) {}

  async listFriends(userId: string, query: FriendsQueryDto) {
    const where: Prisma.FriendshipWhereInput = { userId }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendship.count({ where }),
      this.prisma.friendship.findMany({ where, orderBy: { acceptedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: { friend: { select: this.userSelect() }, } }),
    ])
    return { friends: rows.map((row) => this.friendResponse(row.friend, row.acceptedAt)), pagination: this.pagination(query, total) }
  }

  async listRequests(userId: string, direction: "incoming" | "outgoing", query: FriendsQueryDto) {
    const where: Prisma.FriendRequestWhereInput = direction === "incoming" ? { addresseeId: userId, status: FriendRequestStatus.PENDING } : { requesterId: userId, status: FriendRequestStatus.PENDING }
    const relation = direction === "incoming" ? "requester" : "addressee"
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendRequest.count({ where }),
      this.prisma.friendRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit, include: relation === "requester" ? { requester: { select: this.userSelect() } } : { addressee: { select: this.userSelect() } } }),
    ])
    return { [direction]: rows.map((row) => this.requestResponse((row as any)[relation], row.createdAt)), pagination: this.pagination(query, total) }
  }

  requestFriend(requesterId: string, addresseeId: string) { return this.createFriendRequestTransaction.run({ requesterId, addresseeId }).then(() => ({ message: "Friend request sent" })) }
  makeFriends(userId: string, friendId: string) { return this.createFriendshipTransaction.run({ userId, friendId }) }
  acceptFriendRequest(actorId: string, requesterId: string) { return this.acceptFriendRequestTransaction.run({ actorId, requesterId, addresseeId: actorId }).then(() => ({ message: "Friend request accepted" })) }
  declineFriendRequest(actorId: string, requesterId: string) { return this.respondFriendRequestTransaction.run({ actorId, requesterId, addresseeId: actorId, response: "DECLINED" }).then(() => ({ message: "Friend request declined" })) }
  cancelFriendRequest(actorId: string, addresseeId: string) { return this.respondFriendRequestTransaction.run({ actorId, requesterId: actorId, addresseeId, response: "CANCELED" }).then(() => ({ message: "Friend request canceled" })) }
  removeFriend(userId: string, friendId: string) { return this.removeFriendshipTransaction.run({ userId, friendId }) }
  blockPlayer(userId: string, blockedId: string) { return this.blockPlayerTransaction.run({ blockerId: userId, blockedId }) }
  unblockPlayer(userId: string, blockedId: string) { return this.unblockPlayerTransaction.run({ blockerId: userId, blockedId }) }

  heartbeat(userId: string) { return this.heartbeatPresenceTransaction.run(userId).then((presence) => this.presenceResponse(presence)) }

  async getPresence(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, profile: { select: { isPublic: true } } } })
    if (!user || user.status !== UserStatus.ACTIVE) throw new NotFoundException("Player not found")
    if (viewerId && viewerId !== userId) {
      const friendship = await this.prisma.friendship.findUnique({ where: { userId_friendId: { userId: viewerId, friendId: userId } } })
      if (!friendship && !user.profile?.isPublic) throw new NotFoundException("Presence not found")
    }
    const presence = await this.prisma.presence.findUnique({ where: { userId } })
    return this.presenceResponse(presence)
  }

  async lookupPlayers(userId: string, query: PlayerLookupQueryDto) {
    const search = query.search.trim()
    const players = await this.prisma.user.findMany({ where: { id: { not: userId }, status: UserStatus.ACTIVE, profile: { isPublic: true, }, OR: [{ username: { contains: search, mode: "insensitive" } }, { profile: { displayName: { contains: search, mode: "insensitive" } } }] }, orderBy: { username: "asc" }, take: query.limit, select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, countryCode: true } } } })
    return { players: players.map((player) => ({ id: player.id, playerId: player.id, player_id: player.id, publicUid: player.id, public_uid: player.id, username: player.username, name: player.profile?.displayName || player.username, avatarUrl: player.profile?.avatarUrl ?? null, profileUrl: player.profile?.avatarUrl ?? null, ulid: player.id })) }
  }

  async adminList(query: AdminFriendsQueryDto) {
    const page = query.page || 1
    const limit = query.limit || 50
    const search = query.search?.trim()
    const userWhere: Prisma.UserWhereInput | undefined = search ? { OR: [{ username: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }, { profile: { displayName: { contains: search, mode: "insensitive" } } }] } : undefined
    const relationshipWhere = (status?: FriendRequestStatus): Prisma.FriendRequestWhereInput => ({ ...(status ? { status } : {}), ...(query.userId || userWhere ? { AND: [...(query.userId ? [{ OR: [{ requesterId: query.userId }, { addresseeId: query.userId }] }] : []), ...(userWhere ? [{ OR: [{ requester: userWhere }, { addressee: userWhere }] }] : [])] } : {}) })
    const friendshipWhere: Prisma.FriendshipWhereInput = query.userId || userWhere ? { AND: [...(query.userId ? [{ OR: [{ userId: query.userId }, { friendId: query.userId }] }] : []), ...(userWhere ? [{ OR: [{ user: userWhere }, { friend: userWhere }] }] : [])] } : {}
    const presenceWhere: Prisma.PresenceWhereInput = { ...(query.userId ? { userId: query.userId } : {}), ...(query.online === undefined ? {} : { lastHeartbeatAt: query.online ? { gt: new Date(Date.now() - this.presenceWindowMs()) } : { lte: new Date(Date.now() - this.presenceWindowMs()) } }), ...(userWhere ? { user: userWhere } : {}) }
    const [friendshipTotal, requestTotal, presenceTotal, friendships, requests, presence] = await this.prisma.$transaction([
      this.prisma.friendship.count({ where: friendshipWhere }),
      this.prisma.friendRequest.count({ where: relationshipWhere(query.status) }),
      this.prisma.presence.count({ where: presenceWhere }),
      this.prisma.friendship.findMany({ where: friendshipWhere, orderBy: { acceptedAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: this.userSelect() }, friend: { select: this.userSelect() } } }),
      this.prisma.friendRequest.findMany({ where: relationshipWhere(query.status), orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { requester: { select: this.userSelect() }, addressee: { select: this.userSelect() } } }),
      this.prisma.presence.findMany({ where: presenceWhere, orderBy: { lastHeartbeatAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: this.userSelect() } } }),
    ])
    return { friendships: friendships.map((row) => ({ id: row.id, user: this.adminUser(row.user), friend: this.adminUser(row.friend), acceptedAt: row.acceptedAt })), requests: requests.map((row) => ({ id: row.id, status: row.status, requester: this.adminUser(row.requester), addressee: this.adminUser(row.addressee), createdAt: row.createdAt })), presence: presence.map((row) => ({ user: this.adminUser(row.user), ...this.presenceResponse(row) })), pagination: { page, limit, friendships: friendshipTotal, requests: requestTotal, presence: presenceTotal } }
  }

  async player360Social(userId: string) {
    const [friends, incoming, outgoing, presence] = await this.prisma.$transaction([
      this.prisma.friendship.findMany({ where: { userId }, orderBy: { acceptedAt: "desc" }, take: 200, include: { friend: { select: this.userSelect() } } }),
      this.prisma.friendRequest.findMany({ where: { addresseeId: userId, status: FriendRequestStatus.PENDING }, orderBy: { createdAt: "desc" }, take: 100, include: { requester: { select: this.userSelect() } } }),
      this.prisma.friendRequest.findMany({ where: { requesterId: userId, status: FriendRequestStatus.PENDING }, orderBy: { createdAt: "desc" }, take: 100, include: { addressee: { select: this.userSelect() } } }),
      this.prisma.presence.findUnique({ where: { userId } }),
    ])
    return { friends: friends.map((row) => this.friendResponse(row.friend, row.acceptedAt)), incomingRequests: incoming.map((row) => this.requestResponse(row.requester, row.createdAt)), outgoingRequests: outgoing.map((row) => this.requestResponse(row.addressee, row.createdAt)), presence: this.presenceResponse(presence) }
  }

  private userSelect() { return { id: true, username: true, email: true, createdAt: true, profile: { select: { displayName: true, avatarUrl: true, countryCode: true, isPublic: true } }, presence: { select: { lastHeartbeatAt: true, lastSeenAt: true } } } }
  private adminUser(user: any) { return { id: user.id, username: user.username, email: user.email, displayName: user.profile?.displayName || user.username, avatarUrl: user.profile?.avatarUrl ?? null } }
  private friendResponse(user: any, acceptedAt: Date) { const presence = user.presence; const response = { id: user.id, playerId: user.id, player_id: user.id, publicUid: user.id, public_uid: user.id, username: user.username, name: user.profile?.isPublic === false ? user.username : user.profile?.displayName || user.username, avatarUrl: user.profile?.isPublic === false ? null : user.profile?.avatarUrl ?? null, profileUrl: user.profile?.isPublic === false ? null : user.profile?.avatarUrl ?? null, acceptedAt, accepted_at: acceptedAt, createdAt: user.createdAt, created_at: user.createdAt, online: this.isOnline(presence?.lastHeartbeatAt), lastSeen: presence?.lastSeenAt ?? null, last_seen: presence?.lastSeenAt ?? null, ulid: user.id }; return response }
  private requestResponse(user: any, createdAt: Date) { return { id: user.id, playerId: user.id, player_id: user.id, publicUid: user.id, public_uid: user.id, username: user.username, name: user.profile?.isPublic === false ? user.username : user.profile?.displayName || user.username, avatarUrl: user.profile?.isPublic === false ? null : user.profile?.avatarUrl ?? null, createdAt, created_at: createdAt } }
  private presenceResponse(presence: any) { return { online: this.isOnline(presence?.lastHeartbeatAt), lastSeenAt: presence?.lastSeenAt ?? null, last_seen: presence?.lastSeenAt ?? null, lastHeartbeatAt: presence?.lastHeartbeatAt ?? null } }
  private isOnline(lastHeartbeatAt?: Date) { return Boolean(lastHeartbeatAt && lastHeartbeatAt.getTime() > Date.now() - this.presenceWindowMs()) }
  private presenceWindowMs() { const configured = Number(process.env.PRESENCE_ONLINE_WINDOW_SECONDS); return (Number.isFinite(configured) && configured >= 30 && configured <= 3600 ? configured : PRESENCE_WINDOW_SECONDS) * 1000 }
  private pagination(query: FriendsQueryDto, total: number) { return { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } }
}
