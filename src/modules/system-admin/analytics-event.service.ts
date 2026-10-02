import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"

export type AnalyticsEventInput = {
  eventName: string
  eventVersion?: number
  occurredAt?: Date
  playerId?: string
  sessionId?: string
  matchId?: string
  requestId?: string
  platform?: string
  appVersion?: string
  countryCode?: string
  properties?: Record<string, unknown>
  privacyClass?: "OPERATIONAL" | "SENSITIVE" | "RESTRICTED"
}

/**
 * Server-only analytics event writer. Do not expose this through a player
 * controller: analytics events are authoritative only when emitted by the
 * backend transaction that produced the business event.
 */
@Injectable()
export class AnalyticsEventService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AnalyticsEventInput, transaction: Prisma.TransactionClient | PrismaService = this.prisma) {
    const eventName = input.eventName.trim()
    if (!eventName || eventName.length > 120) throw new Error("Analytics event name must be 1-120 characters")

    return transaction.analyticsEvent.create({
      data: {
        eventName,
        eventVersion: input.eventVersion ?? 1,
        occurredAt: input.occurredAt ?? new Date(),
        playerId: input.playerId,
        sessionId: input.sessionId,
        matchId: input.matchId,
        requestId: input.requestId,
        platform: input.platform?.trim() || undefined,
        appVersion: input.appVersion?.trim() || undefined,
        countryCode: input.countryCode?.trim().toUpperCase() || undefined,
        properties: input.properties as Prisma.InputJsonValue | undefined,
        privacyClass: input.privacyClass ?? "OPERATIONAL",
      },
    })
  }
}
