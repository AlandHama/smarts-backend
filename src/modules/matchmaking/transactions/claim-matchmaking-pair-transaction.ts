import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { GameMode, MatchmakingTicketMode, Prisma } from "@prisma/client";

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction";
import { PrismaService } from "../../../prisma.service";
import {
  botFallbackSeconds,
  queueHeartbeatTimeoutSeconds,
} from "../utilities/matchmaking-policy";
import {
  createAssignmentToken,
  MAX_SERVER_CONTENT_PER_MATCH,
  selectServerContent,
} from "../../matches/utilities/server-content";

type TicketRow = {
  id: string;
  userId: string;
  gameDefinitionId: string;
  mode: MatchmakingTicketMode;
  isRankingMatch: boolean;
  rankingConfigId: string | null;
  rankingStakeAmount: bigint | null;
  rankingEntryFee: bigint | null;
  rankingEntryFeeMicros: bigint | null;
  levelSnapshot: number;
  eloSnapshot: bigint;
  countryCodeSnapshot: string | null;
  constraints: Prisma.JsonValue | null;
  clientVersion: string | null;
  allowBotFallback: boolean;
  createdAt: Date;
};

@Injectable()
export class ClaimMatchmakingPairTransaction extends PrismaTransaction<
  void,
  any
> {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async execute(_: void, transaction: Prisma.TransactionClient) {
    const [{ locked }] = await transaction.$queryRaw<
      Array<{ locked: boolean }>
    >`SELECT pg_try_advisory_xact_lock(hashtextextended('smarts-matchmaking-matcher', 0)) AS locked`;
    if (!locked) return null;

    const [first] = await transaction.$queryRaw<TicketRow[]>`
      SELECT "id", "userId", "gameDefinitionId", "mode", "isRankingMatch", "rankingConfigId", "rankingStakeAmount", "rankingEntryFee", "rankingEntryFeeMicros", "levelSnapshot", "eloSnapshot", "countryCodeSnapshot", "constraints", "clientVersion", "allowBotFallback", "createdAt"
      FROM "MatchmakingTicket" AS ticket
      WHERE ticket."status" = 'SEARCHING'
        AND ticket."expiresAt" > NOW()
        AND ticket."lastHeartbeatAt" > NOW() - make_interval(secs => ${queueHeartbeatTimeoutSeconds()})
        AND (
          (
            ticket."allowBotFallback" = true
            AND ticket."createdAt" <= NOW() - make_interval(secs => ${botFallbackSeconds()})
          )
          OR EXISTS (
            SELECT 1
            FROM "MatchmakingTicket" AS candidate
            WHERE candidate."status" = 'SEARCHING'
              AND candidate."expiresAt" > NOW()
              AND candidate."lastHeartbeatAt" > NOW() - make_interval(secs => ${queueHeartbeatTimeoutSeconds()})
              AND candidate."id" <> ticket."id"
              AND candidate."userId" <> ticket."userId"
              AND candidate."mode" = ticket."mode"
              AND candidate."isRankingMatch" = ticket."isRankingMatch"
              AND (
                ticket."isRankingMatch" = true
                OR candidate."gameDefinitionId" = ticket."gameDefinitionId"
              )
              AND (
                ticket."isRankingMatch" = false
                OR candidate."rankingConfigId" = ticket."rankingConfigId"
              )
          )
        )
      ORDER BY ticket."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    if (!first) return null;

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - first.createdAt.getTime()) / 1000),
    );
    const [second] = await transaction.$queryRaw<TicketRow[]>`
      SELECT "id", "userId", "gameDefinitionId", "mode", "isRankingMatch", "rankingConfigId", "rankingStakeAmount", "rankingEntryFee", "rankingEntryFeeMicros", "levelSnapshot", "eloSnapshot", "countryCodeSnapshot", "constraints", "clientVersion", "allowBotFallback", "createdAt"
      FROM "MatchmakingTicket"
      WHERE "status" = 'SEARCHING'
        AND "expiresAt" > NOW()
        AND "lastHeartbeatAt" > NOW() - make_interval(secs => ${queueHeartbeatTimeoutSeconds()})
        AND "id" <> ${first.id}
        AND "userId" <> ${first.userId}
        -- Ranked matches deliberately use a random active game. The server
        -- uses the first ticket's game for the authoritative match, so two
        -- players who chose different random games can still be paired.
        AND (${first.isRankingMatch} = true OR "gameDefinitionId" = ${first.gameDefinitionId})
        AND "mode"::text = ${first.mode}
        AND "isRankingMatch" = ${first.isRankingMatch}
        AND (${first.isRankingMatch} = false OR "rankingConfigId" = ${first.rankingConfigId})
        -- Casual players should be paired whenever they selected the same
        -- game. ELO is a ranked matchmaking constraint only; applying it to
        -- casual queue tickets can leave two real players waiting until both
        -- independently fall through to bot matches.
        -- A ranking arena is already a narrow stake/config queue. Do not add
        -- ELO as a second hard gate: two eligible players must be able to
        -- pair even when they have very different histories.
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    if (
      !second &&
      !(first.allowBotFallback && elapsedSeconds >= botFallbackSeconds())
    )
      return null;
    const now = new Date();
    const game = await transaction.gameDefinition.findUnique({
      where: { id: first.gameDefinitionId },
      include: {
        configs: {
          where: { active: true },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    const config = game?.configs[0];
    if (!game || !config) return null;
    // Provision the human assignments in the same transaction as the match.
    // Previously a newly-created bot match had zero assignments until a
    // client won the start race and called /start, which allowed legacy game
    // screens to open with an empty challenge list.
    const serverNonce = randomBytes(32).toString("base64url");
    const contentItems = await transaction.gameContentItem.findMany({
      where: { gameDefinitionId: game.id, active: true },
      orderBy: { id: "asc" },
      take: MAX_SERVER_CONTENT_PER_MATCH,
      select: {
        id: true,
        contentType: true,
        prompt: true,
        options: true,
        difficulty: true,
        category: true,
      },
    });
    const selectedItems = selectServerContent(
      contentItems,
      config.maxQuestions,
      serverNonce,
      game.key,
    );
    if (!selectedItems.length) return null;

    const matchMode = second
      ? first.mode === MatchmakingTicketMode.RANKED
        ? GameMode.RANKED
        : GameMode.CASUAL
      : GameMode.BOT;
    const match = await transaction.match.create({
      data: {
        gameDefinitionId: game.id,
        gameConfigId: config.id,
        mode: matchMode,
        status: "CREATED",
        serverNonce,
        createdByUserId: first.userId,
        metadata: {
          source: second ? "MATCHMAKING_QUEUE" : "BOT_FALLBACK",
          isRankingMatch: first.isRankingMatch,
          queueTicketIds: second ? [first.id, second.id] : [first.id],
          serverSnapshots: [
            {
              userId: first.userId,
              level: first.levelSnapshot,
              elo: first.eloSnapshot.toString(),
              countryCode: first.countryCodeSnapshot,
            },
            ...(second
              ? [
                  {
                    userId: second.userId,
                    level: second.levelSnapshot,
                    elo: second.eloSnapshot.toString(),
                    countryCode: second.countryCodeSnapshot,
                  },
                ]
              : []),
          ],
        } as Prisma.InputJsonValue,
      },
    });
    if (
      first.isRankingMatch &&
      second &&
      first.rankingConfigId &&
      first.rankingStakeAmount &&
      first.rankingEntryFeeMicros !== null
    ) {
      const feeMicros =
        first.rankingEntryFeeMicros ||
        (first.rankingEntryFee ?? 0n) * 1_000_000n;
      const totalFeeWhole = (feeMicros * 2n + 1_000_000n - 1n) / 1_000_000n;
      const expectedPayout = first.rankingStakeAmount * 2n - totalFeeWhole;
      await transaction.rankingMatch.create({
        data: {
          matchId: match.id,
          configId: first.rankingConfigId,
          stakeAmountGld: first.rankingStakeAmount,
          entryFeeGld: feeMicros / 1_000_000n,
          entryFeeGldMicros: feeMicros,
          payoutAmountGld: expectedPayout,
          status: "ACTIVE",
        },
      });
      await transaction.match.update({
        where: { id: match.id },
        data: {
          metadata: {
            source: "MATCHMAKING_QUEUE",
            isRankingMatch: true,
            rankingConfigId: first.rankingConfigId,
            rankingStakeAmount: first.rankingStakeAmount.toString(),
            rankingEntryFee: (first.rankingEntryFee ?? 0n).toString(),
            rankingEntryFeeMicros: feeMicros.toString(),
            rankingPayoutAmount: expectedPayout.toString(),
            queueTicketIds: [first.id, second.id],
            serverSnapshots: [
              {
                userId: first.userId,
                level: first.levelSnapshot,
                elo: first.eloSnapshot.toString(),
                countryCode: first.countryCodeSnapshot,
              },
              {
                userId: second.userId,
                level: second.levelSnapshot,
                elo: second.eloSnapshot.toString(),
                countryCode: second.countryCodeSnapshot,
              },
            ],
          } as Prisma.InputJsonValue,
        },
      });
    }
    const round = await transaction.matchRound.create({
      data: {
        matchId: match.id,
        roundIndex: 1,
        gameDefinitionId: game.id,
        status: "CREATED",
        challengeSeedHash: createHash("sha256")
          .update(`${match.serverNonce}:1`)
          .digest("hex"),
      },
    });
    const participants = [
      await transaction.matchParticipant.create({
        data: {
          matchId: match.id,
          userId: first.userId,
          participantType: "PLAYER",
        },
      }),
    ];
    if (second)
      participants.push(
        await transaction.matchParticipant.create({
          data: {
            matchId: match.id,
            userId: second.userId,
            participantType: "PLAYER",
          },
        }),
      );
    else
      await transaction.matchParticipant.create({
        data: { matchId: match.id, participantType: "BOT", result: "PENDING" },
      });

    const expiresAt = new Date(
      now.getTime() + config.maxMatchDurationSeconds * 1000,
    );
    for (const participant of participants) {
      for (let position = 0; position < selectedItems.length; position += 1) {
        const token = createAssignmentToken(
          serverNonce,
          participant.id,
          round.id,
          position,
        );
        await transaction.matchContentAssignment.create({
          data: {
            matchId: match.id,
            roundId: round.id,
            participantId: participant.id,
            contentItemId: selectedItems[position].id,
            position,
            assignmentTokenHash: createHash("sha256")
              .update(token)
              .digest("hex"),
            expiresAt,
          },
        });
      }
    }

    const ids = second ? [first.id, second.id] : [first.id];
    await transaction.matchmakingTicket.updateMany({
      where: { id: { in: ids }, status: "SEARCHING" },
      data: { status: "MATCHED", matchedAt: now, matchId: match.id },
    });
    return {
      ticketIds: ids,
      matchId: match.id,
      status: "MATCHED",
      matchStatus: match.status,
      gameKey: game.key,
      mode: matchMode,
    };
  }
}
