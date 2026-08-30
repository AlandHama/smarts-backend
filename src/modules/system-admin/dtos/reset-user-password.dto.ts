import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator"

export class ResetUserPasswordDto {
  @ApiProperty({ minLength: 6, maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  readonly password!: string
}
