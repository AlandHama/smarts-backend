import { ApiProperty } from "@nestjs/swagger";
import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export const CLIENT_AD_EVENT_TYPES = [
  "impression",
  "click",
  "rewarded",
] as const;

export class CompleteClientAdEventDto {
  @ApiProperty()
  @IsUUID()
  claimId!: string;

  @ApiProperty({ example: "banner" })
  @IsString()
  @MaxLength(40)
  adFormat!: string;

  @ApiProperty({ example: "impression" })
  @IsString()
  @IsIn(CLIENT_AD_EVENT_TYPES)
  eventType!: string;

  @ApiProperty({ example: "client-claim-uuid-impression" })
  @IsString()
  @MinLength(20)
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  providerEventId!: string;

  @ApiProperty({
    description: "The one-time claim token returned before displaying the ad",
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  claimToken!: string;
}
