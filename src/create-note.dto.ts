import { IsNotEmpty, IsString, MaxLength } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class CreateNoteDto {
  @ApiProperty({
    description: "The content of the note.",
    example: "Remember to ship the starter.",
    maxLength: 10_000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body: string
}
