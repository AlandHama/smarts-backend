import { RegisterRequestDto } from "../../auth/dtos/register-request.dto"

// The elevated role is assigned by SystemAdminService, never accepted from
// the request body. Keeping this DTO limited to registration fields also
// satisfies the global forbidNonWhitelisted validation pipe.
export class RegisterAdminDto extends RegisterRequestDto {}
