import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator"

export class ChangePasswordRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  readonly currentPassword!: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  readonly newPassword!: string
}
