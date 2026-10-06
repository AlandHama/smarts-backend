import { IsObject, IsOptional, IsString, MaxLength } from "class-validator"

export class UpdateTileRushPolicyDto {
  @IsObject()
  policy!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
