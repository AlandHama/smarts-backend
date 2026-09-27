import { Injectable } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { writePlayerAudit } from "../../../../../common/helpers/player-audit"

export interface SessionCreateData {
  userId: string
  tokenId: string
  refreshTokenHash: string
  expiresAt: Date
  isMobileSession?: boolean
  clientVersion?: string
  deviceInfo?: string
  ipAddress?: string
  deviceName?: string
  location?: string
  appBuildNumber?: string
  platform?: string
  osName?: string
  osVersion?: string
  deviceType?: string
  deviceModel?: string
  deviceManufacturer?: string
  deviceLocale?: string
  deviceTimezone?: string
  isPhysicalDevice?: boolean
  enforceSingleMobileSession?: boolean
}

@Injectable()
export class CreateSessionTransaction extends PrismaTransaction<SessionCreateData, any> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: SessionCreateData, transaction: Prisma.TransactionClient) {
    const { enforceSingleMobileSession, ...sessionData } = data
    if (enforceSingleMobileSession && data.isMobileSession) {
      const terminated = await transaction.session.updateMany({
        where: { userId: data.userId, isMobileSession: true, sessionStatus: "ACTIVE" },
        data: { sessionStatus: "TERMINATED" },
      })
      if (terminated.count > 0) {
        await writePlayerAudit(transaction, {
          userId: data.userId,
          actorType: PlayerAuditActorType.SYSTEM,
          action: "SESSION_REPLACED",
          entityType: "Session",
          summary: `Replaced ${terminated.count} previous mobile session${terminated.count === 1 ? "" : "s"}`,
          changes: { sessionStatus: { old: "ACTIVE", new: "TERMINATED" } },
          metadata: { terminatedCount: terminated.count, deviceName: data.deviceName, clientVersion: data.clientVersion },
        })
      }
    }
    const session = await transaction.session.create({ data: sessionData })
    await writePlayerAudit(transaction, { userId: data.userId, actorType: PlayerAuditActorType.SYSTEM, action: "SESSION_STARTED", entityType: "Session", entityId: session.id, summary: `Started a ${data.isMobileSession ? "mobile" : "web"} session`, changes: { sessionStatus: { old: "NONE", new: "ACTIVE" } }, metadata: { isMobileSession: data.isMobileSession ?? true, deviceName: data.deviceName, clientVersion: data.clientVersion, platform: data.platform, osName: data.osName, osVersion: data.osVersion, deviceModel: data.deviceModel } })
    return session
  }
}
