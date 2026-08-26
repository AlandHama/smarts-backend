import { ApiProperty } from "@nestjs/swagger"

export class TokenDto {
  @ApiProperty()
  tokenType!: string

  @ApiProperty()
  accessToken!: string

  @ApiProperty({ description: "Access token lifetime in seconds" })
  accessTokenExpires!: number

  @ApiProperty()
  refreshToken!: string

  @ApiProperty({ description: "Refresh token lifetime in seconds" })
  refreshTokenExpires!: number
}
