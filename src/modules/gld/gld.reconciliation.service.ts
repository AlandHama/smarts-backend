import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common"

import { PrismaService } from "../../prisma.service"
import { GldService } from "./gld.service"
import { writeAdminAudit } from "../../common/helpers/admin-audit"

const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000

@Injectable()
export class GldReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GldReconciliationService.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false

  constructor(private readonly prisma: PrismaService, private readonly gld: GldService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS)
    void this.reconcile()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async reconcile() {
    if (this.running) return { skipped: true, reason: "reconciliation-in-progress" }
    this.running = true
    try {
      const currency = await this.prisma.currencyDefinition.findUnique({ where: { code: "GLD" }, select: { id: true, active: true } })
      if (!currency?.active) return { skipped: true, reason: "gld-not-configured" }
      const balances = await this.prisma.walletBalance.aggregate({ where: { currencyId: currency.id, wallet: { status: "ACTIVE" } }, _sum: { amount: true } })
      const actual = balances._sum.amount ?? 0n
      const state = await this.prisma.gldEconomyState.findUnique({ where: { currencyId: currency.id }, select: { id: true, circulatingSupply: true } })
      if (!state) return { skipped: true, reason: "state-not-initialized" }
      const difference = actual - state.circulatingSupply
      if (difference !== 0n) {
        const admin = await this.prisma.user.findFirst({ where: { isSystemAdmin: true, status: "ACTIVE" }, select: { id: true } })
        if (admin) {
          await this.prisma.$transaction((tx) => writeAdminAudit(tx, { actorId: admin.id, action: "GLD_SUPPLY_RECONCILED", entityType: "GldEconomyState", entityId: state.id, reason: "Cached GLD supply differed from active wallet balances", metadata: { cachedSupply: state.circulatingSupply.toString(), actualSupply: actual.toString(), difference: difference.toString() } }))
        }
        this.logger.warn(`GLD supply mismatch detected: cached=${state.circulatingSupply} actual=${actual}`)
      }
      const recalculated = await this.gld.recalculate("supply-reconciliation")
      return { reconciled: true, difference: difference.toString(), recalculated }
    } finally {
      this.running = false
    }
  }
}
