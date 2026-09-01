import { ApiProperty } from "@nestjs/swagger"
import { IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator"

export class UpdateProfileDto {
  @ApiProperty({ example: "Aland", required: false, minLength: 2, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  readonly displayName?: string

  @ApiProperty({ example: "https://cdn.example.com/avatar.png", required: false, nullable: true })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  readonly avatarUrl?: string | null

  @ApiProperty({ example: "IQ", required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  readonly countryCode?: string | null

  @ApiProperty({ example: "Brain game player", required: false, nullable: true, maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  readonly bio?: string | null

  @ApiProperty({ example: "Ada", required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly firstName?: string | null

  @ApiProperty({ example: "Lovelace", required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly lastName?: string | null

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  readonly isPublic?: boolean
}
