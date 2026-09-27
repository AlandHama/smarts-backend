import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator"

export class GoogleAuthRequestDto {
  @ApiProperty({ description: "Google OpenID Connect ID token returned by the mobile SDK" })
  @IsString()
  @MaxLength(8192)
  readonly idToken!: string
}

export class UpdateGoogleAuthConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  readonly enabled!: boolean

  @ApiPropertyOptional({ nullable: true, description: "Web/server OAuth client ID used as the preferred token audience" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly webClientId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly androidClientId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly iosClientId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly desktopClientId?: string | null

  @ApiPropertyOptional({ nullable: true, example: "com.pheonix.gaemverse" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly packageName?: string | null
}
