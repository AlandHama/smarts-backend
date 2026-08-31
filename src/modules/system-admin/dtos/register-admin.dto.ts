import { ApiProperty } from "@nestjs/swagger"

import { RegisterRequestDto } from "../../auth/dtos/register-request.dto"

export class RegisterAdminDto extends RegisterRequestDto {
  @ApiProperty({ description: "Creates an active system administrator account." })
  readonly isSystemAdmin = true
}
