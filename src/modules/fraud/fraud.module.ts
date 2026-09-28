import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { FraudAdminController } from "./fraud-admin.controller"
import { FraudController } from "./fraud.controller"
import { FraudService } from "./fraud.service"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"

@Module({ imports: [DatabaseModule], controllers: [FraudController, FraudAdminController], providers: [FraudService, SystemAdminGuard], exports: [FraudService] })
export class FraudModule {}
