import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator"
import { Transform, Type } from "class-transformer"

export enum AdminSessionStatusFilter {
  Active = "ACTIVE",
  Expired = "EXPIRED",
  Terminated = "TERMINATED",
}

export class SystemAdminSessionsQueryDto {
  @ApiPropertyOptional({ description: "Search username, email, device, IP address, or location." })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string

  @ApiPropertyOptional({ enum: AdminSessionStatusFilter })
  @IsOptional()
  @Transform(({ value }) => value === "" ? undefined : value)
  @IsEnum(AdminSessionStatusFilter)
  readonly status?: AdminSessionStatusFilter

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
