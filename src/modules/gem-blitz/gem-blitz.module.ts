import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { GemBlitzController } from "./gem-blitz.controller"
import { GemBlitzService } from "./gem-blitz.service"
import { MatchesModule } from "../matches/matches.module"

@Module({ imports: [DatabaseModule, MatchesModule], controllers: [GemBlitzController], providers: [GemBlitzService], exports: [GemBlitzService] })
export class GemBlitzModule {}
