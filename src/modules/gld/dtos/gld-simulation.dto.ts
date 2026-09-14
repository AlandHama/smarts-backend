import { IsString, Matches } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class GldSimulationDto {
  @ApiProperty({ description: "Treasury reserve in USD micros", example: "1000000" })
  @IsString()
  @Matches(/^\d+$/)
  reserveUsdMicros!: string

  @ApiProperty({ description: "Circulating GLD supply in integer units", example: "100000" })
  @IsString()
  @Matches(/^\d+$/)
  circulatingSupply!: string
}
