import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength } from "class-validator"

export class AuthCredentialsRequestDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly username!: string

  @ApiProperty({ example: "ChangeMe123!" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  readonly password!: string
}
