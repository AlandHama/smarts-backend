import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator"
import { Transform, Type } from "class-transformer"
import { MatchStatus } from "@prisma/client"

export class SystemAdminMatchesQueryDto {
  @ApiPropertyOptional({ description: "Search match UUID, game, or participant identity." })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string

  @ApiPropertyOptional({ enum: MatchStatus })
  @IsOptional()
  @Transform(({ value }) => value === "" ? undefined : value)
  @IsEnum(MatchStatus)
  readonly status?: MatchStatus

  @ApiPropertyOptional({ description: "Filter matches involving one player UUID." })
  @IsOptional()
  @IsUUID()
  readonly playerId?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page = 1

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit = 50
}
