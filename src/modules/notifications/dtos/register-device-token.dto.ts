import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: "The FCM registration token" })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: ["android", "ios", "web"] })
  @IsString()
  @IsIn(["android", "ios", "web"])
  platform!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
