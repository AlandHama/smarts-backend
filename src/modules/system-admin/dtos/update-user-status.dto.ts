import { ApiProperty } from "@nestjs/swagger"
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator"

export enum SystemAdminUserStatus {
  Active = "ACTIVE",
  Inactive = "INACTIVE",
  Banned = "BANNED",
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: SystemAdminUserStatus })
  @IsEnum(SystemAdminUserStatus)
  readonly status!: SystemAdminUserStatus

  @ApiProperty({ required: false, maxLength: 500, description: "Reason recorded in the administrator audit trail" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly reason?: string
}
