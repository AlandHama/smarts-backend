import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator"

export class UpdateRankingConfigDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000000)
  stakeAmountGld?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  entryFeeGld?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number
}
