import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CompleteMatchDto, CreateMatchDto, MatchEventDto } from "./dtos"
import { CreateMatchTransaction } from "./transactions/create-match-transaction"
import { RecordMatchEventTransaction } from "./transactions/record-match-event-transaction"
import { CompleteMatchTransaction } from "./transactions/complete-match-transaction"
import { ForfeitMatchTransaction } from "./transactions/forfeit-match-transaction"
import { StartMatchTransaction } from "./transactions/start-match-transaction"

@Injectable()
export class MatchService {
  constructor(private readonly prisma: PrismaService, private readonly createMatch: CreateMatchTransaction, private readonly recordEvent: RecordMatchEventTransaction, private readonly completeMatch: CompleteMatchTransaction, private readonly startMatch: StartMatchTransaction, private readonly forfeitMatch: ForfeitMatchTransaction) {}

  create(userId: string, dto: CreateMatchDto) { return this.createMatch.run({ userId, dto }).then((value) => this.serialize(value)) }
  recordEventForPlayer(matchId: string, userId: string, dto: MatchEventDto) { return this.recordEvent.run({ matchId, userId, dto }).then((value) => this.serialize(value)) }
  complete(matchId: string, userId: string, dto: CompleteMatchDto) { return this.completeMatch.run({ matchId, userId, dto }).then((value) => this.serialize(value)) }
  start(matchId: string, userId: string) { return this.startMatch.run({ matchId, userId }).then((value) => this.serialize(value)) }
  forfeit(matchId: string, userId: string) { return this.forfeitMatch.run({ matchId, userId }).then((value) => this.serialize(value)) }

  async get(matchId: string, userId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, participants: { some: { userId } } }, include: { gameDefinition: { select: { key: true, name: true } }, participants: { include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, countryCode: true } } } } } }, assignments: { where: { participant: { userId } }, orderBy: { position: "asc" }, include: { participant: { select: { userId: true } }, contentItem: { select: { id: true, contentType: true, prompt: true, options: true, difficulty: true, category: true } } } }, settlement: true } })
    if (!match) throw new NotFoundException("Match not found")
    return this.serialize(match)
  }

  async getSettlement(matchId: string, userId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, participants: { some: { userId } } }, select: { settlement: true, status: true } })
    if (!match) throw new NotFoundException("Match not found")
    return this.serialize(match.settlement?.settlementJson ?? { status: match.status === "REVIEW" ? "REVIEW" : "PENDING", matchId })
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item instanceof Prisma.Decimal ? item.toString() : item)) as T }
}
