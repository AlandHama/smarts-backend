import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { CreateCurrencyDto, UpdateCurrencyDto, WalletQueryDto } from "./dtos"
import { CreateCurrencyTransaction } from "./transactions/create-currency-transaction"
import { UpdateCurrencyTransaction } from "./transactions/update-currency-transaction"

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService, private readonly createCurrencyTransaction: CreateCurrencyTransaction, private readonly updateCurrencyTransaction: UpdateCurrencyTransaction) {}

  async getWalletForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, include: { balances: { orderBy: { currency: { code: "asc" } }, include: { currency: { select: { code: true, name: true, kind: true, precision: true } } } } } })
    if (!wallet) throw new NotFoundException("Wallet not found")
    return this.serialize({ id: wallet.id, status: wallet.status, balances: wallet.balances.map((balance) => ({ currency: balance.currency, amount: balance.amount })) })
  }

  async listTransactions(userId: string, query: WalletQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100)
    const offset = Math.max(query.offset ?? 0, 0)
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } })
    if (!wallet) throw new NotFoundException("Wallet not found")
    const [total, items] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      this.prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, skip: offset, take: limit, include: { currency: { select: { code: true, name: true } } } }),
    ])
    return this.serialize({ items, pagination: { total, limit, offset, nextOffset: offset + limit < total ? offset + limit : null } })
  }

  listCurrencies(includeInactive = false) { return this.prisma.currencyDefinition.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { code: "asc" }, take: 100, include: { _count: { select: { balances: true, transactions: true } } } }).then((items) => this.serialize(items)) }
  createCurrency(dto: CreateCurrencyDto) { return this.createCurrencyTransaction.run(dto).then((item) => this.serialize(item)) }
  updateCurrency(id: string, dto: UpdateCurrencyDto) { return this.updateCurrencyTransaction.run({ id, dto }).then((item) => this.serialize(item)) }

  async getAdminWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, include: { balances: { orderBy: { currency: { code: "asc" } }, include: { currency: { select: { code: true, name: true, kind: true } } } }, transactions: { orderBy: { createdAt: "desc" }, take: 200, include: { currency: { select: { code: true, name: true } } } } } })
    if (!wallet) throw new NotFoundException("Wallet not found")
    const totals = await this.prisma.$queryRaw<Array<{ currencyId: string; total: bigint }>>(Prisma.sql`SELECT "currencyId", COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" WHEN "direction" = 'DEBIT' THEN -"amount" WHEN "direction" = 'REVERSAL' AND "metadata"->>'reversedDirection' = 'CREDIT' THEN -"amount" ELSE "amount" END), 0)::bigint AS "total" FROM "WalletTransaction" WHERE "walletId" = ${wallet.id} GROUP BY "currencyId"`)
    return this.serialize({ id: wallet.id, status: wallet.status, balances: wallet.balances, transactions: wallet.transactions, reconciliation: wallet.balances.map((balance) => ({ currencyCode: balance.currency.code, balance: balance.amount, ledgerTotal: totals.find((total) => total.currencyId === balance.currencyId)?.total ?? 0n, matches: balance.amount === (totals.find((total) => total.currencyId === balance.currencyId)?.total ?? 0n) })) })
  }

  private serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T }
}

