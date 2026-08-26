import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator"

export class RegisterRequestDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  readonly username!: string

  @ApiProperty({ example: "ChangeMe123!", minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  readonly password!: string

  @ApiProperty({ example: "player@example.com" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  readonly email!: string

  @ApiProperty({ example: "Player123" })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  readonly displayName!: string

  @ApiProperty({ example: "IQ", required: false, minLength: 2, maxLength: 2 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  readonly countryCode?: string

  @ApiProperty({ example: "Ada", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly firstName?: string

  @ApiProperty({ example: "Lovelace", required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly lastName?: string
}
