import { IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator"

export class MobileAdminMutationAuditDto {
  @IsString() @MinLength(3) @MaxLength(100) action!: string
  @IsString() @MinLength(3) @MaxLength(80) entityType!: string
  @IsOptional() @IsString() @MaxLength(255) entityId?: string
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
  @IsString() @MinLength(16) @MaxLength(180) idempotencyKey!: string
  @IsOptional() @IsObject() metadata?: Record<string, unknown>
}
