import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { randomBytes } from "node:crypto"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { CreateUserTransaction } from "../../admin/access/users/transactions/create-user-transaction"

export type GoogleIdentityClaims = {
  subject: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  avatarUrl: string | null
}

type AuthenticateGoogleInput = {
  claims: GoogleIdentityClaims
}

@Injectable()
export class AuthenticateGoogleTransaction extends PrismaTransaction<AuthenticateGoogleInput, any> {
  constructor(prisma: PrismaService, private readonly createUserTransaction: CreateUserTransaction) {
    super(prisma)
  }

  protected async execute(input: AuthenticateGoogleInput, transaction: Prisma.TransactionClient) {
    const existingIdentity = await transaction.externalIdentity.findUnique({
      where: { provider_providerSubject: { provider: "google", providerSubject: input.claims.subject } },
      include: { user: true },
    })
    if (existingIdentity) return existingIdentity.user

    const existingUser = await transaction.user.findUnique({ where: { email: input.claims.email } })
    if (existingUser) {
      await transaction.externalIdentity.create({
        data: {
          userId: existingUser.id,
          provider: "google",
          providerSubject: input.claims.subject,
          email: input.claims.email,
          displayName: input.claims.name,
          avatarUrl: input.claims.avatarUrl,
        },
      })
      return existingUser
    }

    const username = await this.uniqueUsername(input.claims.email, transaction)
    const displayName = this.displayName(input.claims)
    return this.createUserTransaction.runWithinTransaction({
      username,
      password: randomBytes(48).toString("base64url"),
      email: input.claims.email,
      displayName,
      firstName: input.claims.firstName ?? undefined,
      lastName: input.claims.lastName ?? undefined,
      avatarUrl: input.claims.avatarUrl ?? undefined,
      externalIdentity: {
        provider: "google",
        providerSubject: input.claims.subject,
        email: input.claims.email,
        displayName: input.claims.name,
        avatarUrl: input.claims.avatarUrl,
      },
    }, transaction)
  }

  private async uniqueUsername(email: string, transaction: Prisma.TransactionClient) {
    const localPart = email.split("@", 1)[0].toLowerCase().replace(/[^a-z0-9_]+/g, "").slice(0, 42) || "player"
    let candidate = localPart.length >= 3 ? localPart : `${localPart}player`.slice(0, 50)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await transaction.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate
      const suffix = randomBytes(3).toString("hex")
      candidate = `${localPart.slice(0, 50 - suffix.length - 1)}_${suffix}`
    }
    return `player_${randomBytes(8).toString("hex")}`.slice(0, 50)
  }

  private displayName(claims: GoogleIdentityClaims) {
    const value = (claims.name || claims.email.split("@", 1)[0]).trim()
    return (value.length >= 2 ? value : "Google Player").slice(0, 50)
  }
}
