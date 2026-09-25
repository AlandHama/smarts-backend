import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

/**
 * Rebuilds the cached tier pointers after an administrator changes the tier
 * table. Points are intentionally preserved; only the derived step and
 * threshold pointers are recalculated.
 */
export async function reconcilePlayerProgressionRows(
  transaction: Prisma.TransactionClient,
  progressionId: string,
) {
  const progression = await transaction.progressionDefinition.findUnique({
    where: { id: progressionId },
    select: {
      key: true,
      kind: true,
      tiers: {
        orderBy: { pointsThreshold: "asc" },
        select: { step: true, pointsThreshold: true },
      },
    },
  })
  if (!progression || !progression.tiers.length) throw new BadRequestException("Progression must keep at least one tier")
  if (progression.tiers[0].step !== 1 || progression.tiers[0].pointsThreshold !== 0n) {
    throw new BadRequestException("The first progression tier must be step 1 with a 0 threshold")
  }

  const rows = await transaction.playerProgression.findMany({
    where: { progressionId },
    select: { id: true, userId: true, points: true },
  })
  for (const row of rows) {
    let tierIndex = 0
    for (let index = 1; index < progression.tiers.length; index += 1) {
      if (progression.tiers[index].pointsThreshold > row.points) break
      tierIndex = index
    }
    const tier = progression.tiers[tierIndex]
    const nextThreshold = progression.tiers[tierIndex + 1]?.pointsThreshold ?? null
    await transaction.playerProgression.update({
      where: { id: row.id },
      data: { step: tier.step, previousThreshold: tier.pointsThreshold, nextThreshold },
    })

    // Keep the legacy profile projection used by older clients in sync too.
    if (progression.key === "main" && progression.kind === "LEVEL") {
      await transaction.playerProfile.update({ where: { userId: row.userId }, data: { level: tier.step, xp: row.points } })
    }
    if (progression.key === "elo" && progression.kind === "RATING") {
      const bounded = row.points > 2147483647n ? 2147483647 : row.points < 0n ? 0 : Number(row.points)
      await transaction.playerProfile.update({ where: { userId: row.userId }, data: { elo: bounded } })
    }
  }
}
