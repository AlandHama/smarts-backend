import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { Transform, Type } from "class-transformer"
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator"
import { FeedbackEntity, FeedbackStatus, StoredFileVisibility } from "@prisma/client"

const STORAGE_KEY = /^[a-z][a-z0-9_:-]{0,99}$/

export class PlayerStorageItemDto {
  @ApiProperty({ example: "player_country" })
  @IsString()
  @Matches(STORAGE_KEY)
  key!: string

  @ApiProperty({ example: "IQ" })
  @IsString()
  @MaxLength(10000)
  value!: string

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value, obj }) => value ?? obj.is_public)
  isPublic?: boolean

  // Kept as a transport alias for the existing SMARTS client payload.
  @IsOptional()
  @IsBoolean()
  is_public?: boolean

  @ApiPropertyOptional({ example: "1" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  order?: string
}

export class UpdatePlayerStorageDto {
  @ApiProperty({ type: [PlayerStorageItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PlayerStorageItemDto)
  payload!: PlayerStorageItemDto[]
}

export class PublicStorageLookupDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  playerIds!: string[]

  @ApiProperty({ type: [String], example: ["player_country", "profile_url"] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keys!: string[]
}

export class UploadFileDto {
  @ApiProperty({ example: "player-avatar" })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,79}$/)
  purpose!: string

  @ApiPropertyOptional({ enum: StoredFileVisibility, default: StoredFileVisibility.PRIVATE })
  @IsOptional()
  @IsEnum(StoredFileVisibility)
  visibility?: StoredFileVisibility
}

export class FeedbackQueryDto {
  @ApiPropertyOptional({ enum: FeedbackEntity })
  @IsOptional()
  @IsEnum(FeedbackEntity)
  entity?: FeedbackEntity

  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25
}

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackEntity, example: FeedbackEntity.GAME })
  @Transform(({ value }) => typeof value === "string" ? value.toUpperCase() : value)
  @IsEnum(FeedbackEntity)
  entity!: FeedbackEntity

  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  categoryId!: string

  @ApiProperty({ example: "The round froze after submitting an answer." })
  @IsString()
  @MaxLength(5000)
  description!: string

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  entityId?: string

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateFeedbackDto {
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  adminNote?: string
}
