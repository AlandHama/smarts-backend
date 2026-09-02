import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator"

export class ResetUserPasswordDto {
  @ApiProperty({ minLength: 6, maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  readonly password!: string

  @ApiPropertyOptional({ maxLength: 500, description: "Reason recorded in the administrator audit trail" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly reason?: string
}
