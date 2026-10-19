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

function isRandomCasualTicket(ticket: Pick<TicketRow, "constraints" | "isRankingMatch">) {
  return !ticket.isRankingMatch && Boolean(ticket.constraints && typeof ticket.constraints === "object" && !Array.isArray(ticket.constraints) && (ticket.constraints as Record<string, unknown>).randomGame === true);
}

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
                OR (
                  (ticket."constraints"->>'randomGame' = 'true' AND candidate."constraints"->>'randomGame' = 'true')
                  OR (COALESCE(ticket."constraints"->>'randomGame', 'false') <> 'true' AND COALESCE(candidate."constraints"->>'randomGame', 'false') <> 'true' AND candidate."gameDefinitionId" = ticket."gameDefinitionId")
                )
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
        -- Ranked matches can be entered from different client-selected game
        -- cards. Random casual tickets form their own server-wide pool; the
        -- game is selected only after two random players are paired.
        AND (
          ${first.isRankingMatch} = true
          OR (
            (${isRandomCasualTicket(first)} AND "constraints"->>'randomGame' = 'true')
            OR (${!isRandomCasualTicket(first)} AND COALESCE("constraints"->>'randomGame', 'false') <> 'true' AND "gameDefinitionId" = ${first.gameDefinitionId})
          )
        )
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

    const firstGame = await transaction.gameDefinition.findUnique({ where: { id: first.gameDefinitionId }, select: { key: true } })
    const dominoQueue = firstGame?.key === "domino" && !isRandomCasualTicket(first)
    let additional: TicketRow[] = []
    if (dominoQueue && second) {
      additional = await transaction.$queryRaw<TicketRow[]>`
        SELECT "id", "userId", "gameDefinitionId", "mode", "isRankingMatch", "rankingConfigId", "rankingStakeAmount", "rankingEntryFee", "rankingEntryFeeMicros", "levelSnapshot", "eloSnapshot", "countryCodeSnapshot", "constraints", "clientVersion", "allowBotFallback", "createdAt"
        FROM "MatchmakingTicket"
        WHERE "status" = 'SEARCHING' AND "expiresAt" > NOW() AND "lastHeartbeatAt" > NOW() - make_interval(secs => ${queueHeartbeatTimeoutSeconds()})
          AND "id" NOT IN (${first.id}, ${second.id}) AND "userId" <> ${first.userId} AND "gameDefinitionId" = ${first.gameDefinitionId}
          AND "mode"::text = ${first.mode} AND "isRankingMatch" = ${first.isRankingMatch}
        ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 2
      `
    }
    const realTickets = [first, ...(second ? [second] : []), ...additional]
    if (!second && !(first.allowBotFallback && elapsedSeconds >= botFallbackSeconds()))
      return null;
    const now = new Date();
    const gameCandidates = isRandomCasualTicket(first)
      ? await transaction.gameDefinition.findMany({
          where: { active: true, configs: { some: { active: true } }, OR: [{ key: "tile_rush" }, { key: "word_dash" }, { key: "domino" }, { key: "perfect_timing" }, { key: "bomb_path" }, { content: { some: { active: true } } }] },
          include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } },
        })
      : [await transaction.gameDefinition.findUnique({
          where: { id: first.gameDefinitionId },
          include: { configs: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } },
        })].filter((value): value is NonNullable<typeof value> => value !== null);
    const eligibleLevel = Math.min(...realTickets.map((ticket) => ticket.levelSnapshot));
    const eligibleGameCandidates = gameCandidates.filter((candidate) => {
      const minimumLevel = candidate.configs[0]?.minimumPlayerLevel ?? 1;
      if (eligibleLevel < minimumLevel) return false;
      const settings = candidate.configs[0]?.settings && typeof candidate.configs[0].settings === "object" && !Array.isArray(candidate.configs[0].settings) ? candidate.configs[0].settings as Record<string, any> : {};
      const policyKey = candidate.key === "word_dash" ? "wordDashPolicy" : candidate.key === "tile_rush" ? "tileRushPolicy" : candidate.key === "domino" ? "dominoPolicy" : candidate.key === "perfect_timing" ? "perfectTimingPolicy" : candidate.key === "bomb_path" ? "bombPathPolicy" : null;
      const policy = policyKey ? settings[policyKey] as Record<string, any> | undefined : undefined;
      if (candidate.key === "perfect_timing" && policy && (policy.killSwitch === true || !realTickets.every((ticket) => inPerfectTimingRollout(ticket.userId, Number(policy.rolloutPercentage ?? 100))))) return false;
      if (candidate.key === "bomb_path" && policy && (policy.killSwitch === true || !realTickets.every((ticket) => inPerfectTimingRollout(ticket.userId, Number(policy.rolloutPercentage ?? 100))))) return false;
      return !policy || (first.mode === MatchmakingTicketMode.CASUAL ? policy.casualEnabled !== false : policy.rankedEnabled !== false);
    });
    const game = eligibleGameCandidates.length
      ? eligibleGameCandidates[Math.floor(Math.random() * eligibleGameCandidates.length)]
      : null;
    const config = game?.configs[0];
    if (!game || !config) return null;
    const configuredPolicy = config.settings && typeof config.settings === "object" && !Array.isArray(config.settings) ? (config.settings as Record<string, any>)[game.key === "word_dash" ? "wordDashPolicy" : game.key === "tile_rush" ? "tileRushPolicy" : game.key === "domino" ? "dominoPolicy" : game.key === "perfect_timing" ? "perfectTimingPolicy" : game.key === "bomb_path" ? "bombPathPolicy" : ""] : null;
    if (!second && first.mode === MatchmakingTicketMode.RANKED && (game.key === "tile_rush" || game.key === "word_dash" || game.key === "perfect_timing" || game.key === "bomb_path") && configuredPolicy?.rankedBotFallback !== true) return null;
    const isBoardAuthoritative = game.key === "gem_blitz" || game.key === "tile_rush" || game.key === "word_dash" || game.key === "domino" || game.key === "perfect_timing" || game.key === "bomb_path";
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
    if (!selectedItems.length && !isBoardAuthoritative) return null;

    const matchMode = realTickets.length > 1
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
          source: realTickets.length > 1 ? "MATCHMAKING_QUEUE" : "BOT_FALLBACK",
          isRankingMatch: first.isRankingMatch,
          queueTicketIds: realTickets.map((ticket) => ticket.id),
          serverSnapshots: [
            {
              userId: first.userId,
              level: first.levelSnapshot,
              elo: first.eloSnapshot.toString(),
              countryCode: first.countryCodeSnapshot,
            },
            ...realTickets.slice(1).map((ticket) => ({ userId: ticket.userId, level: ticket.levelSnapshot, elo: ticket.eloSnapshot.toString(), countryCode: ticket.countryCodeSnapshot })),
          ],
        } as Prisma.InputJsonValue,
      },
    });
    if (game.key === "tile_rush" || game.key === "word_dash" || game.key === "domino" || game.key === "perfect_timing" || game.key === "bomb_path") {
      const players = realTickets.map((ticket) => ticket.userId);
      for (const playerId of players) {
        await transaction.analyticsEvent.create({
          data: {
            eventName: game.key === "word_dash" ? "WORD_DASH_MATCH_FOUND" : game.key === "tile_rush" ? "TILE_RUSH_MATCH_FOUND" : game.key === "domino" ? "DOMINO_MATCH_FOUND" : game.key === "perfect_timing" ? "PERFECT_TIMING_MATCH_FOUND" : "BOMB_PATH_MATCH_FOUND",
            occurredAt: now,
            matchId: match.id,
            playerId,
            properties: { mode: matchMode, botFallback: !second, ranked: first.isRankingMatch } as Prisma.InputJsonValue,
          },
        });
      }
    }
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
            queueTicketIds: realTickets.map((ticket) => ticket.id),
            serverSnapshots: realTickets.map((ticket) => ({ userId: ticket.userId, level: ticket.levelSnapshot, elo: ticket.eloSnapshot.toString(), countryCode: ticket.countryCodeSnapshot })),
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
    const participants = [];
    for (const ticket of realTickets) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, userId: ticket.userId, participantType: "PLAYER" } }));
    const requiredSeats = game.key === "domino" ? 4 : (game.key === "perfect_timing" || game.key === "bomb_path") ? 2 : Math.max(2, participants.length + 1);
    while (participants.length < requiredSeats) participants.push(await transaction.matchParticipant.create({ data: { matchId: match.id, participantType: "BOT", result: "PENDING" } }));

    const expiresAt = new Date(
      now.getTime() + config.maxMatchDurationSeconds * 1000,
    );
    for (const participant of participants) {
      if (isBoardAuthoritative) continue;
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

    const ids = realTickets.map((ticket) => ticket.id);
    await transaction.matchmakingTicket.updateMany({
      where: { id: { in: ids }, status: "SEARCHING" },
      // Do not leave the second ticket pointing at the game its device chose
      // locally. Older mobile builds read the matched ticket before fetching
      // the full match, which previously produced different games/questions
      // on the two devices.
      data: {
        status: "MATCHED",
        matchedAt: now,
        matchId: match.id,
        gameDefinitionId: game.id,
      },
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

function inPerfectTimingRollout(userId: string, percentage: number): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  const bucket = createHash("sha256").update(`perfect-timing-rollout:${userId}`).digest("hex").slice(0, 8);
  return (Number.parseInt(bucket, 16) / 0xffffffff) * 100 < percentage;
}
