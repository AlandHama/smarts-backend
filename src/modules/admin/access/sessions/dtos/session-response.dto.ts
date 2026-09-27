import { ApiProperty } from "@nestjs/swagger"

export class SessionResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string

  @ApiProperty({ format: "uuid" })
  tokenId!: string

  @ApiProperty({ enum: ["ACTIVE", "TERMINATED"] })
  sessionStatus!: string

  @ApiProperty()
  isMobileSession!: boolean

  @ApiProperty({ required: false, nullable: true })
  deviceName!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceInfo!: string | null

  @ApiProperty({ required: false, nullable: true })
  appBuildNumber!: string | null

  @ApiProperty({ required: false, nullable: true })
  platform!: string | null

  @ApiProperty({ required: false, nullable: true })
  osName!: string | null

  @ApiProperty({ required: false, nullable: true })
  osVersion!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceType!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceModel!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceManufacturer!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceLocale!: string | null

  @ApiProperty({ required: false, nullable: true })
  deviceTimezone!: string | null

  @ApiProperty({ required: false, nullable: true })
  isPhysicalDevice!: boolean | null

  @ApiProperty({ required: false, nullable: true })
  ipAddress!: string | null

  @ApiProperty()
  loginTimestamp!: Date

  @ApiProperty()
  lastActiveTimestamp!: Date

  @ApiProperty()
  expiresAt!: Date
}
