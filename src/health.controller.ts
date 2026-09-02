import { Controller, Get, HttpCode } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"

import { SkipAuth } from "./common/decorators/skip-auth.decorator"
import { PrismaService } from "./prisma.service"

@Controller()
@ApiTags("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SkipAuth()
  @ApiOperation({ summary: "Get API information" })
  @ApiResponse({ status: 200, description: "Returns the available API endpoints." })
  index() {
    return {
      message: "NestJS + Prisma on Railway",
      endpoints: [
        "GET /health",
        "POST /auth/register",
        "POST /auth/login",
        "POST /auth/token/refresh",
        "GET /auth/me",
        "GET /players/me",
        "GET /players/:userId",
        "PATCH /players/me",
        "GET /system-admin (system administrator console)",
        "GET /notes (authenticated)",
      ],
    }
  }

  // The check touches the database, so a deployment that cannot reach Postgres
  // reports unhealthy rather than looking fine and failing on the first request.
  @Get("health")
  @SkipAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Check API and database health" })
  @ApiResponse({ status: 200, description: "Returns the current API and database status." })
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      const migrationTable = await this.prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`
      if (!migrationTable[0]?.present) return { status: "degraded", database: "ok", migrations: "unknown" }
      const failed = await this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`
      const migrations = String(failed[0]?.count ?? 0) === "0" ? "ok" : "failed"
      return { status: migrations === "ok" ? "ok" : "degraded", database: "ok", migrations }
    } catch {
      return { status: "degraded", database: "unreachable", migrations: "unknown" }
    }
  }
}
