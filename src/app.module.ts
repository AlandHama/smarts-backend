import { Module } from "@nestjs/common"

import { HealthController } from "./health.controller"
import { NotesController } from "./notes.controller"
import { PrismaService } from "./prisma.service"

@Module({
  controllers: [HealthController, NotesController],
  providers: [PrismaService],
})
export class AppModule {}
