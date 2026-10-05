import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../database/database.module"
import { GemBlitzController } from "./gem-blitz.controller"
import { GemBlitzService } from "./gem-blitz.service"

@Module({ imports: [DatabaseModule], controllers: [GemBlitzController], providers: [GemBlitzService], exports: [GemBlitzService] })
export class GemBlitzModule {}
