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
  ipAddress!: string | null

  @ApiProperty()
  loginTimestamp!: Date

  @ApiProperty()
  lastActiveTimestamp!: Date

  @ApiProperty()
  expiresAt!: Date
}
