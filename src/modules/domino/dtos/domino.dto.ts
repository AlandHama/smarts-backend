import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator"

export class DominoActionDto {
  @IsInt() @Min(1) sequence!: number
  @IsString() @MinLength(1) @MaxLength(128) clientActionId!: string
  @IsOptional() @IsDateString() clientOccurredAt?: string
  @IsOptional() @IsString() @MaxLength(64) chainHashBefore?: string
}

export class DominoPlayTileDto extends DominoActionDto {
  @IsString() @MinLength(3) @MaxLength(3) tileKey!: string
  @IsIn(["LEFT", "RIGHT"]) side!: "LEFT" | "RIGHT"
}
