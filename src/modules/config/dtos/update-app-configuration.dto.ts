import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator"

export class UpdateAppConfigurationDto {
  @ApiProperty({ example: "1.2.0" })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+(\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/)
  productionVersion!: string

  @ApiProperty({ example: "1.3.0-beta.1" })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^\d+(\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/)
  developmentVersion!: string

  @ApiPropertyOptional({ example: "https://play.google.com/store/apps/details?id=com.pheonix.gaemverse" })
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(1000)
  playStoreUrl?: string
}
