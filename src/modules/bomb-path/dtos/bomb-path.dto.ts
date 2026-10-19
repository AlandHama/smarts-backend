import { Type } from "class-transformer"
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from "class-validator"

export class BombPathPointDto {
  @IsInt() @Min(0) @Max(12)
  row!: number

  @IsInt() @Min(0) @Max(12)
  column!: number
}

export class BombPathStepDto {
  @IsInt() @Min(1) @Max(1000000)
  sequence!: number

  @IsInt() @Min(0) @Max(10)
  roundIndex!: number

  @ValidateNested() @Type(() => BombPathPointDto)
  cell!: BombPathPointDto

  @IsUUID()
  clientActionId!: string

  @IsOptional() @IsDateString()
  clientOccurredAt?: string
}

export class BombPathCompleteDto {
  @IsInt() @Min(1) @Max(1000000)
  sequence!: number

  @IsInt() @Min(0) @Max(10)
  roundIndex!: number

  @IsUUID()
  clientActionId!: string

  @IsOptional() @IsDateString()
  clientOccurredAt?: string
}
