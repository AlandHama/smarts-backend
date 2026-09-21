import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export const GLD_AD_FORMATS = [
  "banner",
  "native",
  "interstitial",
  "rewarded",
  "rewarded_interstitial",
] as const;
export const GLD_AD_EVENT_TYPES = ["impression", "click", "rewarded"] as const;

export class UpsertGldAdRewardPolicyDto {
  @ApiProperty({ example: "banner" })
  @IsString()
  @IsIn(GLD_AD_FORMATS)
  adFormat!: string;

  @ApiProperty({ example: "impression" })
  @IsString()
  @IsIn(GLD_AD_EVENT_TYPES)
  eventType!: string;

  @ApiProperty({
    example: "US",
    description: "ISO country code, region code, or DEFAULT",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  @Matches(/^[A-Za-z][A-Za-z0-9_-]*$/)
  regionCode!: string;

  @ApiProperty({
    example: "0.2",
    description: "Configured GLD amount, with up to 6 decimal places",
  })
  @IsString()
  @Matches(/^\d+(?:\.\d{1,6})?$/)
  rewardAmount!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
