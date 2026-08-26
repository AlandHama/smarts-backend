import { Module } from "@nestjs/common"

import { UsersModule } from "../admin/access/users/users.module"
import { DatabaseModule } from "../../database/database.module"
import { AddXpTransaction } from "./transactions/add-xp-transaction"
import { RecordResultTransaction } from "./transactions/record-result-transaction"
import { UpdateEloTransaction } from "./transactions/update-elo-transaction"
import { UpdateProfileTransaction } from "./transactions/update-profile-transaction"
import { PlayersController } from "./players.controller"
import { PlayersService } from "./players.service"

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [PlayersController],
  providers: [
    PlayersService,
    UpdateProfileTransaction,
    AddXpTransaction,
    UpdateEloTransaction,
    RecordResultTransaction,
  ],
  exports: [PlayersService],
})
export class PlayersModule {}
