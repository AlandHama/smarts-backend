import { ApiProperty } from "@nestjs/swagger"

import { TokenDto } from "./token.dto"
import { UserResponseDto } from "./user-response.dto"

export class LoginResponseDto {
  @ApiProperty({ type: () => TokenDto })
  token!: TokenDto

  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto
}
