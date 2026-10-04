import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { GldController } from "./gld.controller"
import { GldRevenueService } from "./gld.revenue.service"
import { GldService } from "./gld.service"
import { GldReconciliationService } from "./gld.reconciliation.service"
import { GldEmissionService } from "./gld.emission.service"
import { StreaksModule } from "../streaks/streaks.module"
import { WinStreaksModule } from "../win-streaks/win-streaks.module"

@Module({ imports: [DatabaseModule, StreaksModule, WinStreaksModule], controllers: [GldController], providers: [GldRevenueService, GldService, GldReconciliationService, GldEmissionService], exports: [GldService, GldRevenueService, GldReconciliationService, GldEmissionService] })
export class GldModule {}
