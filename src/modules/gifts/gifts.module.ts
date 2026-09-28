import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { ConfigModule } from "../config/config.module"
import { GiftsController, PlayerGiftsController } from "./gifts.controller"
import { GiftsService } from "./gifts.service"
import { SendGiftTransaction } from "./transactions/send-gift-transaction"
import { MissionsModule } from "../missions/missions.module"

@Module({ imports: [DatabaseModule, EconomyModule, ConfigModule, MissionsModule], controllers: [GiftsController, PlayerGiftsController], providers: [GiftsService, SendGiftTransaction], exports: [GiftsService] })
export class GiftsModule {}
