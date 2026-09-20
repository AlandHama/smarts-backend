import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { GldModule } from "../gld/gld.module"
import { AdMobService } from "./admob.service"

@Module({ imports: [DatabaseModule, GldModule], providers: [AdMobService], exports: [AdMobService] })
export class AdMobModule {}
