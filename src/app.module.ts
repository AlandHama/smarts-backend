import { Module } from "@nestjs/common"

import { DatabaseModule } from "./database/database.module"
import { HealthController } from "./health.controller"
import { NotesController } from "./notes.controller"
import { AuthModule } from "./modules/auth/auth.module"
import { PlayersModule } from "./modules/players/players.module"
import { SystemAdminModule } from "./modules/system-admin/system-admin.module"

@Module({
  imports: [DatabaseModule, AuthModule, PlayersModule, SystemAdminModule],
  controllers: [HealthController, NotesController],
})
export class AppModule {}
