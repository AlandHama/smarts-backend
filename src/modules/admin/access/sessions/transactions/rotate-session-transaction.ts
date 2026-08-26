import { Injectable, UnauthorizedException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../../../common/helpers/hash.helper"
import { PrismaTransaction } from "../../../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../../../prisma.service"
import { SessionCreateData } from "./create-session-transaction"

export interface RotateSessionData {
  userId: string
  tokenId: string
  refreshToken: string
  replacement: SessionCreateData
}

@Injectable()
export class RotateSessionTransaction extends PrismaTransaction<RotateSessionData, void> {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected async execute(data: RotateSessionData, transaction: Prisma.TransactionClient) {
    const session = await transaction.session.findFirst({
      where: {
        userId: data.userId,
        tokenId: data.tokenId,
        sessionStatus: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
    })
    if (!session || !(await HashHelper.compare(data.refreshToken, session.refreshTokenHash))) {
      throw new UnauthorizedException("Invalid refresh token")
    }

    const user = await transaction.user.findUnique({ where: { id: data.userId } })
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Invalid refresh token")

    const terminated = await transaction.session.updateMany({
      where: { id: session.id, sessionStatus: "ACTIVE" },
      data: { sessionStatus: "TERMINATED" },
    })
    if (terminated.count !== 1) throw new UnauthorizedException("Refresh token was already used")

    await transaction.session.create({ data: data.replacement })
  }
}
