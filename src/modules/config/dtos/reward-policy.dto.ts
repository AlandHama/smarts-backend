import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator"

export class PublishRewardPolicyDto {
  @ApiProperty({ example: "ad-reward" })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/)
  key!: string

  @ApiProperty({ example: { provider: "admob", adFormats: ["rewarded"] } })
  @IsObject()
  publicConfig!: Record<string, unknown>

  @ApiProperty({ example: { currencyCode: "GLD", rewards: { rewarded: { amount: "10" } } } })
  @IsObject()
  privateConfig!: Record<string, unknown>

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean
}
