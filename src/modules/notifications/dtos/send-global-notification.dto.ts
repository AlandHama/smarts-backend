import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class SendGlobalNotificationDto {
  @ApiProperty({ example: "Weekend challenge is live" })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ example: "Earn double GLD this weekend." })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ description: "Optional app route, such as /wallet" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;
}
