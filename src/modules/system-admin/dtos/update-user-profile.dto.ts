import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsEmail, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator"

export class UpdateUserProfileDto {
  @ApiPropertyOptional({ maxLength: 500, description: "Reason recorded in the administrator audit trail" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly reason?: string

  @ApiPropertyOptional({ minLength: 3, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  readonly username?: string

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  readonly email?: string | null

  @ApiPropertyOptional({ minLength: 2, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  readonly displayName?: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  readonly avatarUrl?: string | null

  @ApiPropertyOptional({ nullable: true, minLength: 2, maxLength: 2 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  readonly countryCode?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  readonly bio?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly firstName?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly lastName?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly isPublic?: boolean
}
