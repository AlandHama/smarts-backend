import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const GLD_AMOUNT = /^\d+(\.\d{1,6})?$/;

export class CreateRankingConfigDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1000000000)
  stakeAmountGld!: number;

  @IsString()
  @Matches(GLD_AMOUNT)
  entryFeeGld!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateRankingConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000000)
  stakeAmountGld?: number;

  @IsOptional()
  @IsString()
  @Matches(GLD_AMOUNT)
  entryFeeGld?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}
