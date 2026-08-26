import { Injectable } from "@nestjs/common"

import { PrismaService } from "../../../../prisma.service"
import { CreateUserInput, CreateUserTransaction } from "./transactions/create-user-transaction"
import { UpdateUserLastOnlineTransaction } from "./transactions/update-user-last-online-transaction"

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createUserTransaction: CreateUserTransaction,
    private readonly updateUserLastOnlineTransaction: UpdateUserLastOnlineTransaction,
  ) {}

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } })
  }

  findByIdentifier(identifier: string) {
    const normalized = identifier.trim().toLowerCase()
    return this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
    })
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  create(registerDto: CreateUserInput) {
    return this.createUserTransaction.run(registerDto)
  }

  updateLastOnline(userId: string) {
    return this.updateUserLastOnlineTransaction.run(userId)
  }

  toResponse(user: { id: string; username: string; firstName: string | null; lastName: string | null; email: string | null; status: string; isSystemAdmin?: boolean }) {
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      status: user.status,
      isSystemAdmin: user.isSystemAdmin ?? false,
    }
  }
}
