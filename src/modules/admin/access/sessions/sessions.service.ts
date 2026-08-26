import { Injectable } from "@nestjs/common"

import { PrismaService } from "../../../../prisma.service"

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
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
  }) {
    return this.prisma.session.create({ data })
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
    return this.prisma.session.updateMany({
      where: { userId, tokenId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }

  terminateAllForUser(userId: string) {
    return this.prisma.session.updateMany({
      where: { userId, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
  }
}
