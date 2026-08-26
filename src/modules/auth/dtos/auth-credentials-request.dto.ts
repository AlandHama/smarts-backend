import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator"

export class AuthCredentialsRequestDto {
  @ApiProperty({ example: "player123", required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  readonly username?: string

  @ApiProperty({ example: "player@example.com", required: false })
  @IsEmail()
  @IsOptional()
  readonly email?: string

  @ApiProperty({ example: "ChangeMe123!" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  readonly password!: string
}
