import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { AdMobService } from "./admob.service"

@Module({ imports: [DatabaseModule], providers: [AdMobService], exports: [AdMobService] })
export class AdMobModule {}
