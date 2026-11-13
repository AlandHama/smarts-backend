import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator"

export class CreateAdImpressionDto {
  @ApiProperty({ example: "startio" })
  @IsString()
  @MaxLength(40)
  provider!: string

  @ApiProperty({ example: "rewarded" })
  @IsString()
  @MaxLength(40)
  adFormat!: string

  @ApiPropertyOptional({ description: "Client-generated identity for one mounted passive ad placement." })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  placementId?: string
}

export class ClaimAdRewardDto {
  @ApiProperty()
  @IsUUID()
  claimId!: string

  @ApiProperty({ example: "startio-event-123" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  providerEventId!: string

  @ApiProperty({ example: "rewarded" })
  @IsString()
  @MaxLength(40)
  adFormat!: string

  @ApiProperty({ description: "The one-time claim token returned by the impression endpoint" })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  claimToken!: string

  @ApiPropertyOptional({ description: "Provider verification token, if the provider supplies one" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  verificationToken?: string
}
