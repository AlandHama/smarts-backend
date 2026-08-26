import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator"
import { Transform, Type } from "class-transformer"

export enum AdminUserStatusFilter {
  Active = "ACTIVE",
  Inactive = "INACTIVE",
  Banned = "BANNED",
}

export class SystemAdminUsersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly search?: string

  @ApiPropertyOptional({ enum: AdminUserStatusFilter })
  @IsOptional()
  @Transform(({ value }) => value === "" ? undefined : value)
  @IsEnum(AdminUserStatusFilter)
  readonly status?: AdminUserStatusFilter

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page = 1

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit = 25
}
