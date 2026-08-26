import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator"

export class SystemAdminLoginDto {
  @ApiProperty({ example: "admin@example.com" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  readonly identifier!: string

  @ApiProperty({ example: "ChangeMe123!" })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  readonly password!: string
}
