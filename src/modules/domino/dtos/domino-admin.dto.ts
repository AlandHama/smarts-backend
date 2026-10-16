import { IsObject, IsOptional, IsString, MaxLength } from "class-validator"

export class UpdateDominoPolicyDto {
  @IsObject()
  policy!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
