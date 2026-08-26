import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator"

export class RegisterRequestDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(100)
  readonly username!: string

  @ApiProperty({ example: "ChangeMe123!", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  readonly password!: string

  @ApiProperty({ example: "Ada" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly firstName!: string

  @ApiProperty({ example: "Lovelace" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly lastName!: string

  @ApiProperty({ example: "ada@example.com", required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  readonly email?: string
}
