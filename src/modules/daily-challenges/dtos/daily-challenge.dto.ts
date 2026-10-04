import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateDailyChallengeConfigurationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: "trivia" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  gameKey?: string;

  @ApiPropertyOptional({ example: "UTC" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  questionsPerDay?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1)
  maxAttempts?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pointsPerCorrect?: number;
}

export class GenerateDailyChallengeDto {
  @ApiPropertyOptional({ example: "2026-10-05" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  dateKey?: string;

  @ApiPropertyOptional({ example: "trivia" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  gameKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class DailyChallengeAnswerDto {
  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  position!: number;

  @ApiPropertyOptional({ example: 2 })
  @IsInt()
  @Min(0)
  selectedIndex!: number;

  @ApiPropertyOptional({ example: 4200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600000)
  timeTakenMs?: number;
}
