import { ApiPropertyOptional } from "@nestjs/swagger"
import { Type } from "class-transformer"
import { IsInt, IsOptional, Max, Min } from "class-validator"

export class SystemAdminAnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 365, description: "Number of completed UTC days to include" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  readonly days = 30
}
