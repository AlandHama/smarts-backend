import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../../prisma.service"
import { PublishRewardPolicyDto } from "./dtos/reward-policy.dto"
import { PublishRewardPolicyTransaction } from "./transactions/publish-reward-policy-transaction"
import { GameService } from "../game/game.service"

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publishTransaction: PublishRewardPolicyTransaction,
    private readonly gameService: GameService,
  ) {}

  listAdmin() {
    return this.prisma.rewardPolicyVersion.findMany({
      orderBy: [{ key: "asc" }, { version: "desc" }],
      take: 500,
      select: { id: true, key: true, version: true, active: true, publicConfig: true, createdAt: true, updatedAt: true },
    })
  }

  async publicProjection() {
    const policies = await this.prisma.rewardPolicyVersion.findMany({
      where: { active: true },
      orderBy: { key: "asc" },
      take: 100,
      select: { key: true, version: true, publicConfig: true },
    })
    return { gameDefinitions: await this.gameService.listDefinitions(false), policies: policies.map((policy) => ({ key: policy.key, version: policy.version, config: policy.publicConfig })) }
  }

  async getActivePrivate<T extends Record<string, unknown>>(key: string): Promise<{ version: number; publicConfig: Record<string, unknown>; privateConfig: T }> {
    const policy = await this.prisma.rewardPolicyVersion.findFirst({ where: { key: key.trim().toLowerCase(), active: true }, orderBy: { version: "desc" } })
    if (!policy) throw new NotFoundException(`Configuration policy '${key}' is not published`)
    return { version: policy.version, publicConfig: policy.publicConfig as Record<string, unknown>, privateConfig: policy.privateConfig as T }
  }

  publish(dto: PublishRewardPolicyDto) {
    if (this.containsSensitivePublicValue(dto.publicConfig)) throw new BadRequestException("Critical reward and verification values must remain server-side")
    return this.publishTransaction.run(dto)
  }

  private containsSensitivePublicValue(value: unknown, path = ""): boolean {
    if (Array.isArray(value)) return value.some((item) => this.containsSensitivePublicValue(item, path))
    if (!value || typeof value !== "object") return false
    return Object.entries(value).some(([key, child]) => {
      const name = `${path}.${key}`.toLowerCase()
      const lowerKey = key.toLowerCase()
      if (/(secret|private|signature|verification|ecpm|multiplier|rewardamount|reward_amount|rewardamounts|reward_amounts|cooldown|dailycap|daily_cap)/.test(name) || (path.toLowerCase().includes("reward") && ["amount", "value", "limit"].includes(lowerKey))) return true
      return this.containsSensitivePublicValue(child, name)
    })
  }
}
