import { IsNotEmpty, IsString, MaxLength } from "class-validator"

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body: string
}
