import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator"
import { ApiPropertyOptional } from "@nestjs/swagger"

export class UpdateGldControlsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emissionsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() catalogSinksPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() giftsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() paidRewardsPaused?: boolean
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) reason?: string
}
