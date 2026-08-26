import { Module } from "@nestjs/common"

import { DatabaseModule } from "./database/database.module"
import { HealthController } from "./health.controller"
import { NotesController } from "./notes.controller"
import { AuthModule } from "./modules/auth/auth.module"

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HealthController, NotesController],
})
export class AppModule {}
