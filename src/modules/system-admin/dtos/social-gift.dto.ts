import { Type } from "class-transformer"
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"

export class CreateSocialGiftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  key!: string

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string

  @IsString()
  @MinLength(1)
  priceGld!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  recipientRewardPercent?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class UpdateSocialGiftDto extends CreateSocialGiftDto {}
