import { IsObject, IsOptional, IsString, MaxLength } from "class-validator"

export class UpdateBombPathPolicyDto {
  @IsObject()
  policy!: Record<string, unknown>

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string
}
