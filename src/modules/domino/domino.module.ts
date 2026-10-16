import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { MatchesModule } from "../matches/matches.module"
import { DominoController } from "./domino.controller"
import { DominoService } from "./domino.service"

@Module({ imports: [DatabaseModule, MatchesModule], controllers: [DominoController], providers: [DominoService], exports: [DominoService] })
export class DominoModule {}
