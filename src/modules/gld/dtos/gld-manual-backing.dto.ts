import { IsString, Matches, MaxLength } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class GldManualBackingDto {
  @ApiProperty({ description: "Additional reserve backing in USD", example: "100.00" })
  @IsString()
  @Matches(/^\d+(?:\.\d{0,6})?$/)
  amountUsd!: string

  @ApiProperty({ maxLength: 500, description: "Reason or source for this additional reserve backing" })
  @IsString()
  @MaxLength(500)
  reason!: string

  @ApiProperty({ description: "Client-generated key preventing duplicate backing submissions" })
  @IsString()
  @MaxLength(160)
  idempotencyKey!: string
}
