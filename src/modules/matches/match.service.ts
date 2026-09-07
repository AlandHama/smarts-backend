import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CompleteMatchDto, CreateMatchDto, MatchEventDto } from "./dtos"
import { createAssignmentToken } from "./utilities/server-content"
import { CreateMatchTransaction } from "./transactions/create-match-transaction"
import { RecordMatchEventTransaction } from "./transactions/record-match-event-transaction"
import { CompleteMatchTransaction } from "./transactions/complete-match-transaction"
import { ForfeitMatchTransaction } from "./transactions/forfeit-match-transaction"
import { StartMatchTransaction } from "./transactions/start-match-transaction"
import { botDisplayName } from "./utilities/bot-display-name"

@Injectable()
export class MatchService {
  constructor(private readonly prisma: PrismaService, private readonly createMatch: CreateMatchTransaction, private readonly recordEvent: RecordMatchEventTransaction, private readonly completeMatch: CompleteMatchTransaction, private readonly startMatch: StartMatchTransaction, private readonly forfeitMatch: ForfeitMatchTransaction) {}

  create(userId: string, dto: CreateMatchDto) { return this.createMatch.run({ userId, dto }).then((value: any) => this.serializeMatch(value, userId)) }
  recordEventForPlayer(matchId: string, userId: string, dto: MatchEventDto) { return this.recordEvent.run({ matchId, userId, dto }).then((value) => this.serialize(value)) }
  complete(matchId: string, userId: string, dto: CompleteMatchDto) { return this.completeMatch.run({ matchId, userId, dto }).then((value) => this.serialize(value)) }
  start(matchId: string, userId: string) { return this.startMatch.run({ matchId, userId }).then((value) => this.serialize(value)) }
  forfeit(matchId: string, userId: string) { return this.forfeitMatch.run({ matchId, userId }).then((value) => this.serialize(value)) }

  async get(matchId: string, userId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, participants: { some: { userId } } }, include: { gameDefinition: { select: { key: true, name: true } }, participants: { include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, countryCode: true } } } } } }, assignments: { where: { participant: { userId } }, orderBy: { position: "asc" }, include: { participant: { select: { userId: true } }, contentItem: { select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } } } }, settlement: true } })
    if (!match) throw new NotFoundException("Match not found")
    return this.serializeMatch({
      ...match,
      participants: match.participants.map((participant) => this.publicParticipant(participant, userId, undefined, match.id)),
      // Assignment tokens are derived on demand for the authenticated
      // participant. The database stores only their hashes, so GET /matches
      // must rebuild the opaque token without exposing the match nonce.
      assignments: match.assignments.map((assignment) => this.publicAssignment(assignment, match.serverNonce)),
    })
  }

  async getSettlement(matchId: string, userId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, participants: { some: { userId } } }, select: { settlement: true, status: true } })
    if (!match) throw new NotFoundException("Match not found")
    return this.serialize(match.settlement?.settlementJson ?? { status: match.status === "REVIEW" ? "REVIEW" : "PENDING", matchId })
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (key, item) => {
      // These values are server verification material. Returning the match
      // nonce would allow a client to derive assignment tokens for other
      // participants, and answer keys must never cross the API boundary.
      if (["serverNonce", "assignmentTokenHash", "answerHash", "answerIndex", "requestHash"].includes(key)) return undefined
      return typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item
    })) as T
  }

  private serializeMatch<T extends Record<string, any>>(value: T, userId?: string): T {
    const currentParticipantId = typeof value.currentParticipantId === "string" ? value.currentParticipantId : undefined
    const matchId = typeof value.id === "string" ? value.id : value.match?.id
    const match = value.match && typeof value.match === "object"
      ? { ...value.match, participants: Array.isArray(value.match.participants) ? value.match.participants.map((participant: any) => this.publicParticipant(participant, userId, currentParticipantId, matchId)) : value.match.participants }
      : value
    return this.serialize({ ...value, ...(value.match ? { match } : {}), ...(!value.match && Array.isArray(value.participants) ? { participants: value.participants.map((participant: any) => this.publicParticipant(participant, userId, undefined, matchId)) } : {}) })
  }

  private publicParticipant(participant: any, userId?: string, currentParticipantId?: string, matchId?: string) {
    const displayName = participant.user?.profile?.displayName || participant.user?.username || (participant.participantType === "BOT" ? botDisplayName(matchId ?? participant.id, participant.id) : undefined)
    return {
      id: participant.id,
      userId: participant.userId,
      participantType: participant.participantType,
      displayName,
      result: participant.result,
      // These are scoreboard projections, not private answer data. Every
      // participant needs them so clients can render live and final scores.
      finalScore: participant.finalScore ?? 0,
      answeredCount: participant.answeredCount ?? 0,
      submittedAt: participant.submittedAt,
      ...(participant.user ? { user: participant.user } : {}),
    }
  }

  private publicAssignment(assignment: any, serverNonce: string) {
    return {
      id: assignment.id,
      participantId: assignment.participantId,
      position: assignment.position,
      token: createAssignmentToken(
        serverNonce,
        assignment.participantId,
        assignment.roundId ?? "",
        assignment.position,
      ),
      contentItem: assignment.contentItem,
      expiresAt: assignment.expiresAt,
    }
  }
}
