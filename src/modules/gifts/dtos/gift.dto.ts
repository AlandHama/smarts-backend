import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator"

export class SendGiftDto {
  @ApiProperty({ description: "The player who will receive the gift" })
  @IsUUID()
  recipientUserId!: string

  @ApiProperty({ example: "steam-gift-card" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  catalogItemKey!: string

  @ApiProperty({ description: "A unique key for this send request" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string
}

export class GiftCatalogQueryDto {
  @ApiPropertyOptional({ example: "main" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  catalogKey?: string
}
