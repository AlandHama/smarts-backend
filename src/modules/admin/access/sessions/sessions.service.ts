import { Injectable } from "@nestjs/common"

import { PrismaService } from "../../../../prisma.service"
import { CreateSessionTransaction, SessionCreateData } from "./transactions/create-session-transaction"
import { EndAllSessionsTransaction } from "./transactions/end-all-sessions-transaction"
import { EndSessionTransaction } from "./transactions/end-session-transaction"
import { EndSessionByIdTransaction } from "./transactions/end-session-by-id-transaction"
import { UpdateSessionLastActiveTransaction } from "./transactions/update-session-last-active-transaction"

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createSessionTransaction: CreateSessionTransaction,
    private readonly endSessionTransaction: EndSessionTransaction,
    private readonly endSessionByIdTransaction: EndSessionByIdTransaction,
    private readonly endAllSessionsTransaction: EndAllSessionsTransaction,
    private readonly updateSessionLastActiveTransaction: UpdateSessionLastActiveTransaction,
  ) {}

  create(data: SessionCreateData) {
    return this.createSessionTransaction.run(data)
  }

  findActive(userId: string, tokenId: string) {
    return this.prisma.session.findFirst({
      where: {
        userId,
        tokenId,
        sessionStatus: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
    })
  }

  updateLastActive(sessionId: string) {
    return this.updateSessionLastActiveTransaction.run(sessionId)
  }

  listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastActiveTimestamp: "desc" },
      take: 100,
      select: {
        id: true,
        tokenId: true,
        sessionStatus: true,
        isMobileSession: true,
        deviceName: true,
        deviceInfo: true,
        ipAddress: true,
        loginTimestamp: true,
        lastActiveTimestamp: true,
        expiresAt: true,
      },
    })
  }

  terminateByTokenId(userId: string, tokenId: string) {
    return this.endSessionTransaction.run({ userId, tokenId })
  }

  terminateById(userId: string, sessionId: string) {
    return this.endSessionByIdTransaction.run({ userId, sessionId })
  }

  terminateAllForUser(userId: string) {
    return this.endAllSessionsTransaction.run(userId)
  }
}
