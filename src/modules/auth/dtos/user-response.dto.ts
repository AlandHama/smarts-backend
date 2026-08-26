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
}
