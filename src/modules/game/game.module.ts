import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { GameController } from "./game.controller"
import { GameService } from "./game.service"
import { UpdateGameConfigTransaction } from "./transactions/update-game-config-transaction"
import { CreateGameContentTransaction } from "./transactions/create-game-content-transaction"

@Module({
  imports: [DatabaseModule],
  controllers: [GameController],
  providers: [GameService, UpdateGameConfigTransaction, CreateGameContentTransaction],
  exports: [GameService, UpdateGameConfigTransaction, CreateGameContentTransaction],
})
export class GameModule {}
