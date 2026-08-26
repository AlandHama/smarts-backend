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
      return { status: "ok", database: "ok" }
    } catch {
      return { status: "degraded", database: "unreachable" }
    }
  }
}
