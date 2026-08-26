import { ConflictException, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { HashHelper } from "../../../../common/helpers/hash.helper"
import { PrismaService } from "../../../../prisma.service"
import { RegisterRequestDto } from "../../../auth/dtos/register-request.dto"

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } })
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async create(registerDto: RegisterRequestDto) {
    try {
      return await this.prisma.user.create({
        data: {
          username: registerDto.username.trim().toLowerCase(),
          passwordHash: await HashHelper.encrypt(registerDto.password),
          firstName: registerDto.firstName.trim(),
          lastName: registerDto.lastName.trim(),
          email: registerDto.email?.trim().toLowerCase(),
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Username or email is already registered")
      }
      throw error
    }
  }

  updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } })
  }

  toResponse(user: { id: string; username: string; firstName: string; lastName: string; email: string | null; status: string }) {
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      status: user.status,
    }
  }
}
