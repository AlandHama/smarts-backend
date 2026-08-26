import { ApiProperty } from "@nestjs/swagger"
import { IsEnum } from "class-validator"

export enum SystemAdminUserStatus {
  Active = "ACTIVE",
  Inactive = "INACTIVE",
  Banned = "BANNED",
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: SystemAdminUserStatus })
  @IsEnum(SystemAdminUserStatus)
  readonly status!: SystemAdminUserStatus
}
