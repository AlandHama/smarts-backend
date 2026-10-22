import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { AllyController } from "./ally.controller"
import { AllyService } from "./ally.service"

@Module({ imports: [DatabaseModule, EconomyModule], controllers: [AllyController], providers: [AllyService], exports: [AllyService] })
export class AllyModule {}

