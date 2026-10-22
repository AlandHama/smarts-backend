import { IsOptional, IsString, Length, Matches } from "class-validator"

export class CreateAllyDto {
  @IsString()
  @Length(3, 80)
  name!: string

  @IsString()
  @Length(2, 12)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  tag!: string

  @IsOptional()
  @IsString()
  @Length(0, 240)
  description?: string
}

export class JoinAllyDto {
  @IsString()
  @Length(2, 12)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  tag!: string
}
