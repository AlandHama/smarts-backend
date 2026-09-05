import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator"
import { Type } from "class-transformer"

export class PlayerAuditsQueryDto {
  @ApiPropertyOptional({ description: "Search username, email, display name, summary, or entity id." })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string

  @ApiPropertyOptional({ description: "Limit the history to one player UUID." })
  @IsOptional()
  @IsUUID()
  readonly playerId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly action?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  readonly entityType?: string

  @ApiPropertyOptional({ description: "Only events created on or after this ISO timestamp." })
  @IsOptional()
  @IsDateString()
  readonly from?: string

  @ApiPropertyOptional({ description: "Only events created before or at this ISO timestamp." })
  @IsOptional()
  @IsDateString()
  readonly to?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page = 1

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit = 50
}
