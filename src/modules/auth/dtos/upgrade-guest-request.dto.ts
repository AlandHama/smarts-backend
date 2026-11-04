import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator"

export class UpgradeGuestRequestDto {
  @ApiProperty({ example: "player123", minLength: 3, maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  readonly username!: string

  @ApiProperty({ example: "player@example.com" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  readonly email!: string

  @ApiProperty({ example: "ChangeMe123!", minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  readonly password!: string

  @ApiProperty({ example: "Player123", minLength: 2, maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  readonly displayName!: string
}
