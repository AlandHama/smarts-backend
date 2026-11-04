import { ApiProperty } from "@nestjs/swagger"

export class UserResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string

  @ApiProperty()
  username!: string

  @ApiProperty({ required: false, nullable: true })
  firstName!: string | null

  @ApiProperty({ required: false, nullable: true })
  lastName!: string | null

  @ApiProperty({ required: false, nullable: true })
  email!: string | null

  @ApiProperty({ enum: ["ACTIVE", "INACTIVE", "BANNED"] })
  status!: string

  @ApiProperty({ enum: ["WHITELABEL", "GOOGLE", "GUEST"] })
  accountOrigin!: string

  @ApiProperty()
  isGuest!: boolean

  @ApiProperty()
  isSystemAdmin!: boolean

  @ApiProperty({ description: "Whether the player has completed first-time onboarding" })
  onboardingCompleted!: boolean
}
