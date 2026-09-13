import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { GldController } from "./gld.controller"
import { GldRevenueService } from "./gld.revenue.service"
import { GldService } from "./gld.service"
import { GldReconciliationService } from "./gld.reconciliation.service"

@Module({ imports: [DatabaseModule], controllers: [GldController], providers: [GldRevenueService, GldService, GldReconciliationService], exports: [GldService, GldRevenueService, GldReconciliationService] })
export class GldModule {}
