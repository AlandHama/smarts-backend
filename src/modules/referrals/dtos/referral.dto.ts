import { ApiProperty } from "@nestjs/swagger"
import { IsString, Matches, MaxLength } from "class-validator"

export class ClaimReferralDto {
  @ApiProperty({ example: "SMARTS-AB12CD" })
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9-]+$/)
  code!: string
}

