import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import { GoogleIdentityClaims } from "./authenticate-google-transaction"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

type LinkInput = { userId: string; claims: GoogleIdentityClaims }
type UnlinkInput = { userId: string; actorId: string; actorType: PlayerAuditActorType }

@Injectable()
export class LinkGoogleIdentityTransaction extends PrismaTransaction<LinkInput, { linked: true; email: string }> {
  protected async execute(input: LinkInput, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({
      where: { id: input.userId },
      select: { id: true, externalIdentities: { where: { provider: "google" }, take: 1 } },
    })
    if (!user) throw new NotFoundException("User not found")
    const identity = await transaction.externalIdentity.findUnique({
      where: { provider_providerSubject: { provider: "google", providerSubject: input.claims.subject } },
      select: { userId: true },
    })
    if (identity && identity.userId !== input.userId) throw new ConflictException("That Google account is already linked to another player")
    if (identity) return { linked: true as const, email: input.claims.email }
    if (user.externalIdentities.length) throw new ConflictException("A different Google account is already linked")
    const emailOwner = await transaction.user.findUnique({ where: { email: input.claims.email }, select: { id: true } })
    if (emailOwner && emailOwner.id !== input.userId) throw new ConflictException("That Google email belongs to another player")

    await transaction.externalIdentity.create({
      data: {
        userId: input.userId,
        provider: "google",
        providerSubject: input.claims.subject,
        email: input.claims.email,
        displayName: input.claims.name,
        avatarUrl: input.claims.avatarUrl,
      },
    })
    await writePlayerAudit(transaction, {
      userId: input.userId,
      actorType: PlayerAuditActorType.PLAYER,
      action: "GOOGLE_ACCOUNT_LINKED",
      entityType: "ExternalIdentity",
      entityId: input.claims.subject,
      summary: "Linked a verified Google account",
      changes: { googleEmail: { old: null, new: input.claims.email } },
    })
    return { linked: true as const, email: input.claims.email }
  }
}

@Injectable()
export class UnlinkGoogleIdentityTransaction extends PrismaTransaction<UnlinkInput, { unlinked: true }> {
  protected async execute(input: UnlinkInput, transaction: Prisma.TransactionClient) {
    const user = await transaction.user.findUnique({
      where: { id: input.userId },
      select: { id: true, accountOrigin: true, externalIdentities: { where: { provider: "google" }, take: 1 } },
    })
    if (!user) throw new NotFoundException("User not found")
    const identity = user.externalIdentities[0]
    if (!identity) throw new NotFoundException("No Google account is linked")
    if (user.accountOrigin === "GOOGLE") throw new BadRequestException("Google-created accounts cannot be unlinked until password sign-in is enabled")

    await transaction.externalIdentity.delete({ where: { id: identity.id } })
    await writePlayerAudit(transaction, {
      userId: input.userId,
      actorType: input.actorType,
      action: "GOOGLE_ACCOUNT_UNLINKED",
      entityType: "ExternalIdentity",
      entityId: identity.id,
      summary: "Unlinked the Google account",
      metadata: { actorId: input.actorId },
    })
    return { unlinked: true as const }
  }
}
