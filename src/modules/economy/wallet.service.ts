import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma.service";
import {
  CreateCurrencyDto,
  GldTransferDto,
  UpdateCurrencyDto,
  WalletQueryDto,
} from "./dtos";
import { CreateCurrencyTransaction } from "./transactions/create-currency-transaction";
import { UpdateCurrencyTransaction } from "./transactions/update-currency-transaction";
import { TransferGldTransaction } from "./transactions/transfer-gld-transaction";

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createCurrencyTransaction: CreateCurrencyTransaction,
    private readonly updateCurrencyTransaction: UpdateCurrencyTransaction,
    private readonly transferGldTransaction: TransferGldTransaction,
  ) {}

  async getWalletForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        balances: {
          orderBy: { currency: { code: "asc" } },
          include: {
            currency: {
              select: { code: true, name: true, kind: true, precision: true },
            },
          },
        },
      },
    });
    if (!wallet) throw new NotFoundException("Wallet not found");
    const gld = await this.prisma.currencyDefinition.findUnique({
      where: { code: "GLD" },
      select: {
        id: true,
        gldEconomyState: { select: { displayedValueUsdMicros: true } },
      },
    });
    return this.serialize({
      id: wallet.id,
      status: wallet.status,
      balances: wallet.balances.map((balance) => {
        const displayedValue =
          balance.currency.code === "GLD"
            ? (gld?.gldEconomyState?.displayedValueUsdMicros ?? null)
            : null;
        return {
          currency: balance.currency,
          amount: balance.amount,
          exactAmount: balance.exactAmount,
          ...(displayedValue === null
            ? {}
            : {
                displayedValueUsdMicros: displayedValue,
                estimatedDisplayValueUsdMicros: balance.exactAmount
                  .mul(displayedValue.toString())
                  .floor()
                  .toFixed(0),
              }),
        };
      }),
    });
  }

  async listTransactions(userId: string, query: WalletQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException("Wallet not found");
    const [total, items] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          currency: { select: { code: true, name: true, precision: true } },
          wallet: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                  profile: { select: { displayName: true, avatarUrl: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    return this.serialize({
      items: await this.enrichTransactions(items),
      pagination: {
        total,
        limit,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
      },
    });
  }

  async getTransactionForUser(userId: string, transactionId: string) {
    const item = await this.prisma.walletTransaction.findFirst({
      where: { id: transactionId, wallet: { userId } },
      include: {
        currency: { select: { code: true, name: true, precision: true } },
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                profile: { select: { displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("Wallet transaction not found");
    return this.serialize((await this.enrichTransactions([item]))[0]);
  }

  async searchTransactions(query: {
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    const requestedLimit = Number.isFinite(query.limit) ? query.limit! : 50;
    const requestedOffset = Number.isFinite(query.offset) ? query.offset! : 0;
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
    const offset = Math.max(Math.trunc(requestedOffset), 0);
    const q = query.q?.trim();
    const searchFilters: Prisma.WalletTransactionWhereInput[] = q
      ? [
          { sourceId: { contains: q, mode: "insensitive" } },
          {
            wallet: {
              user: { username: { contains: q, mode: "insensitive" } },
            },
          },
          { wallet: { user: { email: { contains: q, mode: "insensitive" } } } },
          {
            wallet: {
              user: {
                profile: { displayName: { contains: q, mode: "insensitive" } },
              },
            },
          },
        ]
      : [];
    if (
      q &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        q,
      )
    ) {
      searchFilters.unshift({ id: q });
    }
    const sourceTypes = [
      "SIGNUP",
      "MATCH",
      "AD",
      "REFERRAL",
      "PURCHASE",
      "RANKING_MATCH_ENTRY",
      "RANKING_MATCH_PAYOUT",
      "RANKING_MATCH_REFUND",
      "REFUND",
      "ADMIN",
      "SYSTEM",
    ];
    if (q && sourceTypes.includes(q.toUpperCase())) {
      searchFilters.push({ sourceType: q.toUpperCase() as any });
    }
    const where: Prisma.WalletTransactionWhereInput = searchFilters.length
      ? { OR: searchFilters }
      : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          currency: { select: { code: true, name: true, precision: true } },
          wallet: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                  profile: { select: { displayName: true, avatarUrl: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    return this.serialize({
      items: await this.enrichTransactions(items),
      pagination: {
        total,
        limit,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
      },
    });
  }

  async getAdminTransaction(transactionId: string) {
    const item = await this.prisma.walletTransaction.findUnique({
      where: { id: transactionId },
      include: {
        currency: { select: { code: true, name: true, precision: true } },
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                profile: { select: { displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("Wallet transaction not found");
    return this.serialize((await this.enrichTransactions([item]))[0]);
  }

  async quoteGldTransfer(amount: string) {
    if (!/^\d+$/.test(amount.trim()) || BigInt(amount) <= 0n)
      throw new BadRequestException(
        "Transfer amount must be a positive whole number",
      );
    const controls = await this.prisma.gldAdminControl.findUnique({
      where: { singletonKey: "default" },
      select: { gldTransferFeeBps: true },
    });
    const feeBps = controls?.gldTransferFeeBps ?? 0;
    const requested = BigInt(amount);
    const fee = (requested * BigInt(feeBps) + 9_999n) / 10_000n;
    return this.serialize({
      amount: requested,
      feeAmount: fee,
      totalDebit: requested + fee,
      feeBps,
      feePercent: feeBps / 100,
    });
  }

  transferGld(senderUserId: string, dto: GldTransferDto) {
    return this.transferGldTransaction.run({ senderUserId, dto });
  }

  listCurrencies(includeInactive = false) {
    return this.prisma.currencyDefinition
      .findMany({
        where: includeInactive ? undefined : { active: true },
        orderBy: { code: "asc" },
        take: 100,
        include: { _count: { select: { balances: true, transactions: true } } },
      })
      .then((items) => this.serialize(items));
  }
  createCurrency(dto: CreateCurrencyDto) {
    return this.createCurrencyTransaction
      .run(dto)
      .then((item) => this.serialize(item));
  }
  updateCurrency(id: string, dto: UpdateCurrencyDto) {
    return this.updateCurrencyTransaction
      .run({ id, dto })
      .then((item) => this.serialize(item));
  }

  async getAdminWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        balances: {
          orderBy: { currency: { code: "asc" } },
          include: {
            currency: { select: { code: true, name: true, kind: true } },
          },
        },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 200,
          include: { currency: { select: { code: true, name: true } } },
        },
      },
    });
    if (!wallet) throw new NotFoundException("Wallet not found");
    const totals = await this.prisma.$queryRaw<
      Array<{ currencyId: string; total: bigint }>
    >(
      Prisma.sql`SELECT "currencyId", COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" WHEN "direction" = 'DEBIT' THEN -"amount" WHEN "direction" = 'REVERSAL' AND "metadata"->>'reversedDirection' = 'CREDIT' THEN -"amount" ELSE "amount" END), 0)::bigint AS "total" FROM "WalletTransaction" WHERE "walletId" = ${wallet.id} GROUP BY "currencyId"`,
    );
    return this.serialize({
      id: wallet.id,
      status: wallet.status,
      balances: wallet.balances,
      transactions: wallet.transactions,
      reconciliation: wallet.balances.map((balance) => ({
        currencyCode: balance.currency.code,
        balance: balance.amount,
        ledgerTotal:
          totals.find((total) => total.currencyId === balance.currencyId)
            ?.total ?? 0n,
        matches:
          balance.amount ===
          (totals.find((total) => total.currencyId === balance.currencyId)
            ?.total ?? 0n),
      })),
    });
  }

  async topBalances(currencyCode: string, limit = 10) {
    const currency = await this.prisma.currencyDefinition.findUnique({
      where: { code: currencyCode.trim().toUpperCase() },
      select: { id: true, code: true, name: true },
    });
    if (!currency) throw new NotFoundException("Currency definition not found");
    const rows = await this.prisma.walletBalance.findMany({
      where: {
        currencyId: currency.id,
        wallet: { user: { status: "ACTIVE" } },
      },
      orderBy: [{ amount: "desc" }, { updatedAt: "asc" }, { walletId: "asc" }],
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        amount: true,
        wallet: {
          select: {
            userId: true,
            user: {
              select: {
                username: true,
                profile: {
                  select: {
                    displayName: true,
                    avatarUrl: true,
                    countryCode: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    let rank = 0;
    let previousAmount: bigint | undefined;
    return this.serialize(
      rows.map((row, index) => {
        if (previousAmount === undefined || row.amount !== previousAmount)
          rank = index + 1;
        previousAmount = row.amount;
        return {
          rank,
          playerId: row.wallet.userId,
          username: row.wallet.user.username,
          displayName:
            row.wallet.user.profile?.displayName ?? row.wallet.user.username,
          avatarUrl: row.wallet.user.profile?.avatarUrl ?? null,
          countryCode: row.wallet.user.profile?.countryCode ?? null,
          amount: row.amount,
          currency: { code: currency.code, name: currency.name },
        };
      }),
    );
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ) as T;
  }

  private async enrichTransactions(items: any[]) {
    const ids = [
      ...new Set(
        items.flatMap((item) => {
          const metadata =
            item.metadata && typeof item.metadata === "object"
              ? (item.metadata as Record<string, unknown>)
              : {};
          const id =
            item.direction === "DEBIT"
              ? metadata.recipientUserId
              : metadata.senderUserId;
          return typeof id === "string" ? [id] : [];
        }),
      ),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            username: true,
            email: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return items.map((item) => this.enrichTransaction(item, byId));
  }

  private enrichTransaction(item: any, users: Map<string, any>) {
    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};
    const reason = typeof metadata.reason === "string" ? metadata.reason : null;
    const counterpartyId =
      item.direction === "DEBIT"
        ? metadata.recipientUserId
        : metadata.senderUserId;
    const counterparty =
      typeof counterpartyId === "string"
        ? (users.get(counterpartyId) ?? null)
        : null;
    // Transfer metadata contains the other user's UUID. Resolve it below in
    // the batch-independent form used by both mobile and admin responses.
    const title =
      reason === "GLD_PLAYER_TRANSFER"
        ? item.direction === "DEBIT"
          ? `Sent to ${counterparty?.profile?.displayName || counterparty?.username || "player"}`
          : `Received from ${counterparty?.profile?.displayName || counterparty?.username || "player"}`
        : this.transactionTitle(item.sourceType, item.direction);
    return {
      ...item,
      transactionId: item.id,
      title,
      description:
        reason === "GLD_PLAYER_TRANSFER"
          ? item.direction === "DEBIT"
            ? `GLD sent to ${counterparty?.profile?.displayName || counterparty?.username || "another player"}`
            : `GLD received from ${counterparty?.profile?.displayName || counterparty?.username || "another player"}`
          : reason ||
            `${this.transactionTitle(item.sourceType, item.direction)} transaction`,
      reason,
      counterpartyUserId:
        typeof counterpartyId === "string" ? counterpartyId : null,
      counterparty,
      user: item.wallet?.user ?? null,
    };
  }

  private transactionTitle(sourceType: string, direction: string) {
    const titles: Record<string, string> = {
      MATCH: "Match reward",
      AD: "Ad reward",
      REFERRAL: "Referral reward",
      PURCHASE: "Purchase",
      RANKING_MATCH_ENTRY: "Ranking match entry",
      RANKING_MATCH_PAYOUT: "Ranking match payout",
      RANKING_MATCH_REFUND: "Ranking match refund",
      REFUND: "Refund",
      ADMIN: "Administrator adjustment",
      SYSTEM: "System adjustment",
      SIGNUP: "Signup reward",
    };
    return (
      titles[sourceType] || `${direction === "CREDIT" ? "Credit" : "Debit"}`
    );
  }
}
