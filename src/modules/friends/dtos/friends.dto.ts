import { ApiPropertyOptional } from "@nestjs/swagger"
import { Transform, Type } from "class-transformer"
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator"

import { FriendRequestStatus } from "@prisma/client"

export class FriendsQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @ApiPropertyOptional({ default: 50, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50
}

export class PlayerLookupQueryDto {
  @ApiPropertyOptional({ description: "Search by username or public display name" }) @IsString() @MaxLength(100) search!: string
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20
}

export class AdminFriendsQueryDto extends FriendsQueryDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID("4") userId?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string
  @ApiPropertyOptional({ enum: FriendRequestStatus }) @IsOptional() @IsEnum(FriendRequestStatus) status?: FriendRequestStatus
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === "true" ? true : value === "false" ? false : value) @IsBoolean() online?: boolean
}
