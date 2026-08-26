import { ApiProperty } from "@nestjs/swagger"

export class UserResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string

  @ApiProperty()
  username!: string

  @ApiProperty()
  firstName!: string

  @ApiProperty()
  lastName!: string

  @ApiProperty({ required: false, nullable: true })
  email!: string | null

  @ApiProperty({ enum: ["ACTIVE", "INACTIVE", "BANNED"] })
  status!: string
}
