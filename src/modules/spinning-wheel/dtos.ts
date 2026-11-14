import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator"

export class SpinningWheelSegmentDto {
  @IsString() @MinLength(2) type!: string
  @IsString() @MinLength(1) amount!: string
  @IsInt() @Min(1) @Max(10000) weight!: number
}

export class CreateSpinningWheelDto {
  @IsString() @MinLength(2) key!: string
  @IsString() @MinLength(2) name!: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() themeKey?: string
  @IsOptional() @IsBoolean() active?: boolean
  @IsString() purchasePriceGld!: string
  @IsOptional() @IsBoolean() dailyEnabled?: boolean
  @IsOptional() @IsInt() @Min(1) @Max(100) dailyQuantity?: number
  @IsOptional() @IsBoolean() levelUpEnabled?: boolean
  @IsOptional() @IsInt() @Min(1) @Max(100) levelUpQuantity?: number
  @IsOptional() @IsBoolean() rankUpEnabled?: boolean
  @IsOptional() @IsInt() @Min(1) @Max(100) rankUpQuantity?: number
  @IsOptional() @IsBoolean() matchWinEnabled?: boolean
  @IsOptional() @IsInt() @Min(1) @Max(100) matchWinQuantity?: number
  @IsArray() segments!: SpinningWheelSegmentDto[]
}

export class UpdateSpinningWheelDto extends CreateSpinningWheelDto {}

export class PurchaseSpinningWheelDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number
}

export class SpinSpinningWheelDto {
  @IsOptional() @IsString() wheelKey?: string
}

export class ClaimSpinningWheelDto {
  @IsString() @MinLength(20) claimToken!: string
}
