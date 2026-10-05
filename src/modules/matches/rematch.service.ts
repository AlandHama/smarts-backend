import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { GameMode, Prisma, RematchRequestStatus } from "@prisma/client";

import { PrismaService } from "../../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateMatchTransaction } from "./transactions/create-match-transaction";

const REQUEST_TTL_MS = 2 * 60 * 1000;
const requestInclude = {
  requester: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
  recipient: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
  gameDefinition: { select: { key: true, name: true } },
};

type RequestWithPeople = Prisma.RematchRequestGetPayload<{ include: typeof requestInclude }>;
type Database = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RematchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createMatch: CreateMatchTransaction,
    private readonly notifications: NotificationsService,
  ) {}

  async request(userId: string, originalMatchId: string) {
    let created = false;
    const record = await this.prisma.$transaction(async (tx) => {
      const context = await this.loadSettledContext(tx, originalMatchId, userId);
      const opponent = context.participants.find((participant) => participant.userId !== userId);
      if (!opponent?.userId) throw new ConflictException("This match cannot be rematched");

      const pendingReverse = await tx.rematchRequest.findFirst({
        where: { originalMatchId, requesterId: opponent.userId, recipientId: userId, status: RematchRequestStatus.PENDING },
      });
      if (pendingReverse && pendingReverse.expiresAt > new Date()) throw new ConflictException("The other player has already requested a rematch");
      if (pendingReverse) await tx.rematchRequest.update({ where: { id: pendingReverse.id }, data: { status: RematchRequestStatus.EXPIRED, respondedAt: new Date() } });

      const previous = await tx.rematchRequest.findFirst({
        where: { originalMatchId, requesterId: userId, recipientId: opponent.userId },
        orderBy: { createdAt: "desc" },
        include: requestInclude,
      });
      if (previous?.status === RematchRequestStatus.PENDING && previous.expiresAt > new Date()) return previous;
      if (previous?.status === RematchRequestStatus.PENDING) await tx.rematchRequest.update({ where: { id: previous.id }, data: { status: RematchRequestStatus.EXPIRED, respondedAt: new Date() } });

      created = true;
      const createdRequest = await tx.rematchRequest.create({
        data: {
          originalMatchId,
          requesterId: userId,
          recipientId: opponent.userId,
          gameDefinitionId: context.gameDefinitionId,
          expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
        },
        include: requestInclude,
      });
      if (context.gameDefinition.key === "gem_blitz") await tx.analyticsEvent.create({ data: { eventName: "GEM_BLITZ_REMATCH_REQUESTED", occurredAt: new Date(), matchId: originalMatchId, playerId: userId, properties: { requestId: createdRequest.id, gameKey: context.gameDefinition.key } as Prisma.InputJsonValue } })
      return createdRequest
    });

    if (created) await this.notifyRequested(record);
    return this.serialize(record, userId);
  }

  async status(userId: string, originalMatchId: string) {
    await this.loadSettledContext(this.prisma, originalMatchId, userId);
    let record = await this.prisma.rematchRequest.findFirst({
      where: { originalMatchId, OR: [{ requesterId: userId }, { recipientId: userId }] },
      orderBy: { createdAt: "desc" },
      include: requestInclude,
    });
    if (record?.status === RematchRequestStatus.PENDING && record.expiresAt <= new Date()) {
      record = await this.prisma.rematchRequest.update({
        where: { id: record.id },
        data: { status: RematchRequestStatus.EXPIRED, respondedAt: new Date() },
        include: requestInclude,
      });
    }
    return record ? this.serialize(record, userId) : { status: "NONE", originalMatchId, canRequest: true };
  }

  async accept(userId: string, requestId: string) {
    let acceptedNow = false;
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RematchRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
      const request = await this.loadRequest(tx, requestId);
      if (!request) throw new NotFoundException("Rematch request not found");
      if (request.recipientId !== userId) throw new BadRequestException("Only the invited player can accept this rematch");
      if (request.status === RematchRequestStatus.ACCEPTED && request.newMatchId) return request;
      if (request.status !== RematchRequestStatus.PENDING) throw new ConflictException("This rematch request is no longer available");
      if (request.expiresAt <= new Date()) {
        await tx.rematchRequest.update({ where: { id: request.id }, data: { status: RematchRequestStatus.EXPIRED, respondedAt: new Date() } });
        throw new ConflictException("This rematch request has expired");
      }

      const context = await this.loadSettledContext(tx, request.originalMatchId, request.recipientId);
      if (!context.participants.some((participant) => participant.userId === request.requesterId)) throw new ConflictException("The original match is no longer eligible for a rematch");
      const activeMatch = await tx.matchParticipant.findFirst({
        where: { userId: { in: [request.requesterId, request.recipientId] }, match: { status: { in: ["CREATED", "STARTED"] } } },
        select: { id: true },
      });
      if (activeMatch) throw new ConflictException("One of the players is already in another match");

      const newMatch = await this.createMatch.runWithinTransaction({
        userId: request.requesterId,
        dto: {
          gameKey: context.gameDefinition.key,
          mode: GameMode.CASUAL,
          opponentUserId: request.recipientId,
          metadata: { rematchRequestId: request.id, originalMatchId: request.originalMatchId },
        },
      }, tx);
      acceptedNow = true;
      if (context.gameDefinition.key === "gem_blitz") await tx.analyticsEvent.create({ data: { eventName: "GEM_BLITZ_REMATCH_ACCEPTED", occurredAt: new Date(), matchId: newMatch.match.id, playerId: userId, properties: { originalMatchId: request.originalMatchId, requestId: request.id } as Prisma.InputJsonValue } })
      return tx.rematchRequest.update({
        where: { id: request.id },
        data: { status: RematchRequestStatus.ACCEPTED, acceptedAt: new Date(), respondedAt: new Date(), newMatchId: newMatch.match.id },
        include: requestInclude,
      });
    });

    if (acceptedNow) {
      await this.notifications.createPlayerNotification({
        recipientId: record.requesterId,
        notificationType: "match.rematch.accepted",
        title: "⚔️ Rematch accepted",
        body: `${this.nameOf(record.recipient)} accepted your rematch. Starting game…`,
        data: { route: `/matches/rematch?requestId=${record.id}&matchId=${record.newMatchId ?? ""}&gameKey=${encodeURIComponent(record.gameDefinition.key)}`, rematchId: record.id, originalMatchId: record.originalMatchId, matchId: record.newMatchId ?? "", gameKey: record.gameDefinition.key },
      });
    }
    return this.serialize(record, userId);
  }

  async decline(userId: string, requestId: string) {
    let declinedNow = false;
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RematchRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
      const request = await this.loadRequest(tx, requestId);
      if (!request) throw new NotFoundException("Rematch request not found");
      if (request.recipientId !== userId) throw new BadRequestException("Only the invited player can decline this rematch");
      if (request.status !== RematchRequestStatus.PENDING) return request;
      declinedNow = true;
      return tx.rematchRequest.update({ where: { id: request.id }, data: { status: RematchRequestStatus.DECLINED, respondedAt: new Date() }, include: requestInclude });
    });
    if (declinedNow) {
      await this.notifications.createPlayerNotification({
        recipientId: record.requesterId,
        notificationType: "match.rematch.declined",
        title: "Rematch declined",
        body: `${this.nameOf(record.recipient)} declined the rematch.`,
        data: { route: `/matches/rematch?requestId=${record.id}`, rematchId: record.id, originalMatchId: record.originalMatchId },
      });
    }
    return this.serialize(record, userId);
  }

  async cancel(userId: string, requestId: string) {
    const request = await this.loadRequest(this.prisma, requestId);
    if (!request) throw new NotFoundException("Rematch request not found");
    if (request.requesterId !== userId) throw new BadRequestException("Only the requester can cancel this rematch");
    if (request.status !== RematchRequestStatus.PENDING) return this.serialize(request, userId);
    const canceled = await this.prisma.rematchRequest.update({ where: { id: request.id }, data: { status: RematchRequestStatus.CANCELED, respondedAt: new Date() }, include: requestInclude });
    return this.serialize(canceled, userId);
  }

  private loadRequest(db: Database, id: string) {
    return db.rematchRequest.findUnique({ where: { id }, include: requestInclude });
  }

  private async loadSettledContext(db: Database, matchId: string, userId: string) {
    const match = await db.match.findFirst({
      where: { id: matchId, participants: { some: { userId } } },
      select: {
        id: true,
        mode: true,
        status: true,
        gameDefinitionId: true,
        gameDefinition: { select: { key: true, name: true } },
        settlement: { select: { id: true } },
        participants: { select: { userId: true, participantType: true } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    if (match.mode !== GameMode.CASUAL || match.status !== "SETTLED" || !match.settlement || match.participants.length !== 2 || match.participants.some((participant) => participant.participantType !== "PLAYER" || !participant.userId)) throw new ConflictException("Only settled two-player casual matches can be rematched");
    return match;
  }

  private notifyRequested(record: RequestWithPeople) {
    return this.notifications.createPlayerNotification({
      recipientId: record.recipientId,
      notificationType: "match.rematch.requested",
      title: "⚔️ Rematch request",
      body: `${this.nameOf(record.requester)} wants a rematch.`,
      data: { route: `/matches/rematch?requestId=${record.id}&gameKey=${encodeURIComponent(record.gameDefinition.key)}`, rematchId: record.id, originalMatchId: record.originalMatchId, gameKey: record.gameDefinition.key },
    });
  }

  private nameOf(user: RequestWithPeople["requester"]) {
    return user.profile?.displayName || user.username;
  }

  private serialize(record: RequestWithPeople, userId: string) {
    return {
      id: record.id,
      status: record.status,
      originalMatchId: record.originalMatchId,
      requesterId: record.requesterId,
      recipientId: record.recipientId,
      requesterName: this.nameOf(record.requester),
      recipientName: this.nameOf(record.recipient),
      gameKey: record.gameDefinition.key,
      gameName: record.gameDefinition.name,
      expiresAt: record.expiresAt,
      acceptedAt: record.acceptedAt,
      respondedAt: record.respondedAt,
      newMatchId: record.newMatchId,
      isRequester: record.requesterId === userId,
      isRecipient: record.recipientId === userId,
      canRequest: record.status !== RematchRequestStatus.PENDING && record.status !== RematchRequestStatus.ACCEPTED,
    };
  }
}
