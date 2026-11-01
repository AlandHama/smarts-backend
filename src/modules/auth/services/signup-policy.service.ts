import { ForbiddenException, Injectable } from "@nestjs/common"

import { PrismaService } from "../../../prisma.service"

@Injectable()
export class SignupPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async assertEnabled() {
    const configuration = await this.prisma.appConfiguration.findUnique({
      where: { key: "default" },
      select: { signupEnabled: true },
    })
    if (configuration?.signupEnabled === false) {
      throw new ForbiddenException("New player signups are currently disabled")
    }
  }
}
