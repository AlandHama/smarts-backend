import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { ChatConversationType, ChatParticipantRole, Prisma, UserStatus } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { NotificationsService } from "../notifications/notifications.service"
import { CreatePartyInviteDto, QueuePartyDto } from "./dtos"

const ACTIVE_PARTY_STATUSES = ["CREATED", "READY", "QUEUED", "MATCH_FOUND", "COMMITTED", "IN_MATCH", "RESULTS"]
const publicUser = { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, level: true, elo: true, countryCode: true } } } satisfies Prisma.UserSelect

@Injectable()
export class PartyService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async policy() {
    return this.prisma.cooperativeConfiguration.upsert({ where: { key: "default" }, create: { key: "default" }, update: {} })
  }

  async current(userId: string) {
    await this.prisma.party.updateMany({ where: { status: { in: ACTIVE_PARTY_STATUSES }, expiresAt: { lt: new Date() } }, data: { status: "EXPIRED", closedAt: new Date() } })
    // Older settlements could leave their queue entry as MATCHED. Normalize
    // those terminal entries before resolving the current party so returning
    // players cannot be sent back into the finished match.
    const terminalMatches = await this.prisma.cooperativeMatch.findMany({
      where: { status: { in: ["CANCELLED", "SETTLED"] }, participants: { some: { userId } } },
      select: { matchId: true },
    })
    if (terminalMatches.length) {
      await this.prisma.cooperativeQueueEntry.updateMany({
        where: { matchId: { in: terminalMatches.map((row) => row.matchId) }, status: "MATCHED" },
        data: { status: "SETTLED" },
      })
    }
    const membership = await this.prisma.partyMember.findFirst({ where: { userId, leftAt: null, party: { status: { in: ACTIVE_PARTY_STATUSES } } }, include: { party: { include: { members: { where: { leftAt: null }, include: { user: { select: publicUser } }, orderBy: { joinedAt: "asc" } }, conversation: { select: { id: true } }, queueEntries: { where: { status: { in: ["SEARCHING", "MATCHED"] } }, orderBy: { queuedAt: "desc" }, take: 1 } } } }, orderBy: { joinedAt: "desc" } })
    return membership ? this.serializeParty(membership.party, userId) : null
  }

  async stats(userId: string) {
    const rows = await this.prisma.cooperativeParticipant.findMany({
      where: { userId, cooperativeMatch: { status: "SETTLED" } },
      orderBy: { createdAt: "desc" },
      select: {
        finalScore: true,
        team: { select: { result: true } },
        cooperativeMatch: { select: { matchId: true, settledAt: true } },
      },
    })
    const sourceIds = rows.map(({ cooperativeMatch }) => `${cooperativeMatch.matchId}:xp:${userId}`)
    const xpEvents = sourceIds.length
      ? await this.prisma.progressionEvent.findMany({
          where: { userId, sourceType: "MATCH", sourceId: { in: sourceIds } },
          select: { delta: true },
        })
      : []
    const summary = rows.reduce(
      (value, row) => {
        value.score += row.finalScore
        if (row.team.result === "WIN") value.wins += 1
        else if (row.team.result === "LOSS") value.losses += 1
        else if (row.team.result === "DRAW") value.draws += 1
        return value
      },
      { wins: 0, losses: 0, draws: 0, score: 0 },
    )
    const xp = xpEvents.reduce((total, event) => total + event.delta, 0n)
    return this.serialize({
      ...summary,
      matches: rows.length,
      xp: xp < 0n ? 0n : xp,
      lastPlayedAt: rows[0]?.cooperativeMatch.settledAt ?? null,
    })
  }

  async authorizeParty(userId: string, partyId: string) {
    const snapshot = await this.current(userId)
    if (!snapshot || snapshot.id !== partyId) throw new NotFoundException("Party is not available")
    return snapshot
  }

  async invites(userId: string) {
    await this.prisma.partyInvite.updateMany({ where: { inviteeId: userId, status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED", respondedAt: new Date() } })
    const rows = await this.prisma.partyInvite.findMany({ where: { inviteeId: userId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 30, include: { inviter: { select: publicUser }, party: { select: { id: true, mode: true, expiresAt: true } } } })
    return rows.map((row) => ({ id: row.id, partyId: row.partyId, mode: row.party.mode, expiresAt: row.expiresAt, createdAt: row.createdAt, inviter: this.user(row.inviter) }))
  }

  async create(userId: string) {
    const config = await this.policy(); this.assertEnabled(config)
    const existing = await this.current(userId); if (existing) return existing
    const now = new Date()
    const party = await this.prisma.$transaction((tx) => tx.party.create({
      data: {
        hostUserId: userId,
        expiresAt: new Date(now.getTime() + config.partyIdleMinutes * 60_000),
        members: { create: { userId, role: "HOST" } },
        conversation: { create: { type: ChatConversationType.GROUP, name: "Ally lobby", createdById: userId, participants: { create: { userId, role: ChatParticipantRole.ADMIN } } } },
      },
      include: { members: { include: { user: { select: publicUser } } }, conversation: { select: { id: true } }, queueEntries: true },
    }))
    return this.serializeParty(party, userId)
  }

  async invite(userId: string, partyId: string, dto: CreatePartyInviteDto) {
    const party = await this.requireHost(userId, partyId); const config = await this.policy()
    if (party.members.filter((member) => member.leftAt == null).length >= party.maxMembers) throw new ConflictException("This party is already full")
    if (dto.inviteeId === userId) throw new ForbiddenException("You cannot invite yourself")
    const target = await this.prisma.user.findUnique({ where: { id: dto.inviteeId }, select: { id: true, status: true } }); if (!target || target.status !== UserStatus.ACTIVE) throw new NotFoundException("Player not found")
    const friendship = await this.prisma.friendship.findFirst({ where: { OR: [{ userId, friendId: dto.inviteeId }, { userId: dto.inviteeId, friendId: userId }] } }); if (!friendship) throw new ForbiddenException("You can only invite accepted friends")
    const blocked = await this.prisma.friendBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: dto.inviteeId }, { blockerId: dto.inviteeId, blockedId: userId }] } }); if (blocked) throw new ForbiddenException("This player is unavailable")
    const existingParty = await this.prisma.partyMember.findFirst({ where: { userId: dto.inviteeId, leftAt: null, party: { status: { in: ACTIVE_PARTY_STATUSES } } } }); if (existingParty) throw new ConflictException("This player is already in a party")
    const existingInvite = await this.prisma.partyInvite.findFirst({ where: { partyId, inviteeId: dto.inviteeId, status: "PENDING", expiresAt: { gt: new Date() } } }); if (existingInvite) return { id: existingInvite.id, status: existingInvite.status, expiresAt: existingInvite.expiresAt }
    const invite = await this.prisma.partyInvite.create({ data: { partyId, inviterId: userId, inviteeId: dto.inviteeId, expiresAt: new Date(Date.now() + config.inviteExpiryMinutes * 60_000) } })
    const inviter = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true, profile: { select: { displayName: true } } } })
    await this.notifications.createPlayerNotification({ recipientId: dto.inviteeId, notificationType: "cooperative.party.invite", title: "Party invitation", body: `${inviter?.profile?.displayName || inviter?.username || "A friend"} invited you to an ally lobby.`, data: { route: "/cooperative/party", partyId, inviteId: invite.id } }).catch(() => undefined)
    return { id: invite.id, partyId, inviteeId: dto.inviteeId, status: invite.status, expiresAt: invite.expiresAt }
  }

  async acceptInvite(userId: string, inviteId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.partyInvite.findFirst({ where: { id: inviteId, inviteeId: userId, status: "PENDING" }, include: { party: { include: { members: { where: { leftAt: null } } } } } }); if (!invite) throw new NotFoundException("Party invitation not found")
      if (invite.expiresAt < new Date()) { await tx.partyInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED", respondedAt: new Date() } }); throw new ConflictException("Party invitation expired") }
      if (invite.party.status !== "CREATED" && invite.party.status !== "READY") throw new ConflictException("Party is no longer accepting members")
      const current = await tx.partyMember.findFirst({ where: { userId, leftAt: null, party: { status: { in: ACTIVE_PARTY_STATUSES } } } }); if (current) throw new ConflictException("You are already in a party")
      if (invite.party.members.length >= invite.party.maxMembers) throw new ConflictException("Party is full")
      await tx.partyMember.create({ data: { partyId: invite.partyId, userId, role: "MEMBER" } })
      const conversation = await tx.chatConversation.findUnique({ where: { partyId: invite.partyId }, select: { id: true } }); if (conversation) await tx.chatParticipant.create({ data: { conversationId: conversation.id, userId, role: ChatParticipantRole.MEMBER } })
      await tx.partyInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED", respondedAt: new Date() } }); await tx.party.update({ where: { id: invite.partyId }, data: { status: "READY" } }); return invite.partyId
    })
    return this.current(userId).then((party) => ({ partyId: result, party }))
  }

  async declineInvite(userId: string, inviteId: string) { const result = await this.prisma.partyInvite.updateMany({ where: { id: inviteId, inviteeId: userId, status: "PENDING" }, data: { status: "DECLINED", respondedAt: new Date() } }); if (!result.count) throw new NotFoundException("Party invitation not found"); return { declined: true } }

  async leave(userId: string, partyId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const member = await tx.partyMember.findUnique({ where: { partyId_userId: { partyId, userId } }, include: { party: { include: { members: { where: { leftAt: null }, orderBy: { joinedAt: "asc" } } } } } }); if (!member || member.leftAt) throw new NotFoundException("Party membership not found")
      await tx.partyMember.update({ where: { id: member.id }, data: { leftAt: new Date(), status: "LEFT" } }); const remaining = member.party.members.filter((row) => row.userId !== userId)
      const conversation = await tx.chatConversation.findUnique({ where: { partyId }, select: { id: true } }); if (conversation) await tx.chatParticipant.deleteMany({ where: { conversationId: conversation.id, userId } })
      if (!remaining.length) { await tx.party.update({ where: { id: partyId }, data: { status: "CLOSED", closedAt: new Date() } }); if (conversation) await tx.chatConversation.update({ where: { id: conversation.id }, data: { archivedAt: new Date() } }) }
      else if (member.party.hostUserId === userId) { await tx.party.update({ where: { id: partyId }, data: { hostUserId: remaining[0].userId } }); await tx.partyMember.update({ where: { id: remaining[0].id }, data: { role: "HOST" } }) }
      return { partyId, closed: !remaining.length }
    }); return result
  }

  async queue(userId: string, partyId: string, dto: QueuePartyDto) {
    const config = await this.policy(); this.assertEnabled(config); if (dto.mode === "RANDOM" && !config.cooperativeRandomEnabled) throw new ForbiddenException("Random cooperative matches are unavailable"); if (dto.mode === "RANKED" && !config.cooperativeRankedEnabled) throw new ForbiddenException("Ranked cooperative matches are unavailable")
    const party = await this.requireHost(userId, partyId); const members = party.members.filter((member) => member.leftAt == null); if (members.length < 2 && !config.allowSoloParty) throw new ConflictException("Invite a friend before entering the party queue")
    if (dto.mode === "RANKED" && members.length !== 2) throw new ConflictException("Ranked cooperative queues require exactly two friends in the party")
    const now = new Date(); const profiles = members.map((member) => member.user.profile).filter(Boolean); const averageElo = profiles.length ? Math.round(profiles.reduce((sum, profile) => sum + (profile?.elo || 0), 0) / profiles.length) : 0; const minLevel = profiles.length ? Math.min(...profiles.map((profile) => profile?.level || 1)) : 1; if (dto.mode === "RANKED" && (minLevel < config.minLevel || averageElo < config.minElo || Math.max(...profiles.map((profile) => profile?.elo || 0)) - Math.min(...profiles.map((profile) => profile?.elo || 0)) > config.rankedPartyRatingSpread)) throw new ForbiddenException("This party does not meet ranked eligibility")
    if (dto.mode === "RANKED" && config.minCompletedMatches > 0) { const stats = await this.prisma.playerStats.findMany({ where: { userId: { in: members.map((member) => member.userId) } }, select: { gamesPlayed: true } }); if (stats.length !== members.length || stats.some((row) => row.gamesPlayed < config.minCompletedMatches)) throw new ForbiddenException("Every ranked teammate must complete more matches first") }
    if (dto.mode === "RANKED") { const restricted = await this.prisma.fraudProfile.count({ where: { userId: { in: members.map((member) => member.userId) }, status: { in: ["RESTRICTED", "SUSPENDED"] } } }); if (restricted) throw new ForbiddenException("A teammate is restricted from ranked rewards") }
    const existing = await this.prisma.cooperativeQueueEntry.findFirst({ where: { partyId, status: "SEARCHING" } }); if (existing) return this.serializeQueue(existing)
    try {
      const entry = await this.prisma.$transaction(async (tx) => { await tx.party.update({ where: { id: partyId }, data: { status: "QUEUED", mode: dto.mode, queuedAt: now, expiresAt: new Date(now.getTime() + config.queueTimeoutSeconds * 1000) } }); return tx.cooperativeQueueEntry.create({ data: { partyId, mode: dto.mode, ratingSnapshot: averageElo, levelSnapshot: minLevel, countrySnapshot: profiles[0]?.countryCode || null, clientVersion: dto.clientVersion, expiresAt: new Date(now.getTime() + config.queueTimeoutSeconds * 1000) } }) })
      return this.serializeQueue(entry)
    } catch (error) {
      // Two taps/devices can queue the same party at the same time. The
      // partial active-entry index makes that race safe; return the winner's
      // entry instead of surfacing a 500 to the player.
      if ((error as { code?: string }).code !== "P2002") throw error
      const existing = await this.prisma.cooperativeQueueEntry.findFirst({ where: { partyId, mode: dto.mode, status: "SEARCHING" }, orderBy: { queuedAt: "desc" } })
      if (!existing) throw error
      return this.serializeQueue(existing)
    }
  }

  async cancelQueue(userId: string, partyId: string) { const party = await this.requireHost(userId, partyId); await this.prisma.$transaction([this.prisma.cooperativeQueueEntry.updateMany({ where: { partyId, status: "SEARCHING" }, data: { status: "CANCELLED" } }), this.prisma.party.update({ where: { id: party.id }, data: { status: party.members.filter((member) => member.leftAt == null).length > 1 ? "READY" : "CREATED", queuedAt: null } })]); return this.current(userId) }
  async heartbeat(userId: string, partyId: string) { await this.prisma.partyMember.updateMany({ where: { partyId, userId, leftAt: null }, data: { lastHeartbeatAt: new Date() } }); await this.prisma.cooperativeQueueEntry.updateMany({ where: { partyId, status: "SEARCHING" }, data: { lastHeartbeatAt: new Date(), expiresAt: new Date(Date.now() + 120_000) } }); return this.current(userId) }

  private async requireHost(userId: string, partyId: string) { const party = await this.prisma.party.findFirst({ where: { id: partyId, hostUserId: userId, status: { in: ACTIVE_PARTY_STATUSES } }, include: { members: { where: { leftAt: null }, include: { user: { select: publicUser } }, orderBy: { joinedAt: "asc" } }, conversation: { select: { id: true } }, queueEntries: { where: { status: "SEARCHING" }, take: 1 } } }); if (!party) throw new NotFoundException("Party not found or you are not the host"); return party }
  private assertEnabled(config: { enabled: boolean; cooperativePartyEnabled: boolean }) { if (!config.enabled || !config.cooperativePartyEnabled) throw new ForbiddenException("Cooperative parties are temporarily unavailable") }
  private user(row: any) { return { id: row.id, username: row.username, name: row.profile?.displayName || row.username, avatarUrl: row.profile?.avatarUrl || null, level: row.profile?.level || 1, elo: row.profile?.elo || 0, countryCode: row.profile?.countryCode || null } }
  private serializeParty(party: any, userId: string) { return { id: party.id, hostUserId: party.hostUserId, status: party.status, mode: party.mode, maxMembers: party.maxMembers, expiresAt: party.expiresAt, queuedAt: party.queuedAt, conversationId: party.conversation?.id || null, members: (party.members || []).map((member: any) => ({ id: member.id, userId: member.userId, role: member.role, status: member.status, readyAt: member.readyAt, lastHeartbeatAt: member.lastHeartbeatAt, user: this.user(member.user), isSelf: member.userId === userId })), queue: party.queueEntries?.[0] ? this.serializeQueue(party.queueEntries[0]) : null } }
  private serializeQueue(entry: any) { return { id: entry.id, partyId: entry.partyId, mode: entry.mode, status: entry.status, matchId: entry.matchId || null, ratingSnapshot: entry.ratingSnapshot, levelSnapshot: entry.levelSnapshot, countrySnapshot: entry.countrySnapshot, queuedAt: entry.queuedAt, expiresAt: entry.expiresAt } }
  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}
