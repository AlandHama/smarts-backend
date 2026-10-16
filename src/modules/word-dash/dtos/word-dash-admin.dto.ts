import { IsObject, IsOptional, IsString, MaxLength } from "class-validator"

export class UpdateWordDashPolicyDto {
  @IsObject()
  policy!: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
