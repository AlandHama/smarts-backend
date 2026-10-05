import { IsObject, IsOptional, IsString, MaxLength } from "class-validator"

export class UpdateGemBlitzPolicyDto {
  @IsObject()
  policy!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
