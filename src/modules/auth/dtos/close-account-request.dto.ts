import { ApiProperty } from "@nestjs/swagger"
import { IsIn, IsString } from "class-validator"

/** Explicit confirmation prevents accidental account closure requests. */
export class CloseAccountRequestDto {
  @ApiProperty({ enum: ["CLOSE"], description: "Must be exactly CLOSE" })
  @IsString()
  @IsIn(["CLOSE"])
  readonly confirmation!: "CLOSE"
}
