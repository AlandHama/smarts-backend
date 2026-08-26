import { Controller, Get, HttpCode } from "@nestjs/common"

import { PrismaService } from "./prisma.service"

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  index() {
    return {
      message: "NestJS + Prisma on Railway",
      endpoints: ["GET /health", "GET /notes", "POST /notes"],
    }
  }

  // The check touches the database, so a deployment that cannot reach Postgres
  // reports unhealthy rather than looking fine and failing on the first request.
  @Get("health")
  @HttpCode(200)
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: "ok", database: "ok" }
    } catch {
      return { status: "degraded", database: "unreachable" }
    }
  }
}
