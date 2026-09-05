import { BadRequestException, Injectable } from "@nestjs/common"
import { FeedbackEntity, PlayerAuditActorType, Prisma } from "@prisma/client"

import { PrismaTransaction } from "../../../common/helpers/prisma-transaction"
import { PrismaService } from "../../../prisma.service"
import type { CreateFeedbackDto } from "../dtos/storage.dto"
import { writePlayerAudit } from "../../../common/helpers/player-audit"

export type CreateFeedbackInput = { userId: string; dto: CreateFeedbackDto }

@Injectable()
export class CreateFeedbackTransaction extends PrismaTransaction<CreateFeedbackInput, any> {
  constructor(prisma: PrismaService) { super(prisma) }

  protected async execute(input: CreateFeedbackInput, transaction: Prisma.TransactionClient) {
    const category = await transaction.feedbackCategory.findFirst({ where: { id: input.dto.categoryId, entity: input.dto.entity, active: true } })
    if (!category) throw new BadRequestException("Feedback category is not available for this entity")
    const recent = await transaction.playerFeedback.count({ where: { userId: input.userId, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } })
    if (recent >= 10) throw new BadRequestException("Feedback submission limit reached; try again later")
    const feedback = await transaction.playerFeedback.create({ data: { userId: input.userId, categoryId: category.id, entity: input.dto.entity, entityId: input.dto.entityId, description: input.dto.description.trim(), metadata: input.dto.metadata as Prisma.InputJsonValue | undefined } })
    await writePlayerAudit(transaction, { userId: input.userId, actorType: PlayerAuditActorType.PLAYER, action: "FEEDBACK_SUBMITTED", entityType: "PlayerFeedback", entityId: feedback.id, summary: `Submitted ${input.dto.entity.toLowerCase()} feedback`, metadata: { categoryId: category.id, entityId: input.dto.entityId } })
    return feedback
  }
}
