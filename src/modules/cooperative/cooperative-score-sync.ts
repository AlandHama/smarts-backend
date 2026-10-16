import { Prisma } from "@prisma/client"

/** Synchronizes board-game scores into the cooperative team projection. */
export async function syncCooperativeParticipantScore(tx: Prisma.TransactionClient, matchId: string, matchParticipantId: string, score: number) {
  const cooperative = await tx.cooperativeMatch.findUnique({ where: { matchId }, select: { id: true } })
  if (!cooperative) return
  const participant = await tx.cooperativeParticipant.findUnique({ where: { matchParticipantId }, select: { id: true, teamId: true } })
  if (!participant) return
  await tx.cooperativeParticipant.update({ where: { id: participant.id }, data: { finalScore: Math.max(0, Math.trunc(score)) } })
  await syncCooperativeTeamScore(tx, participant.teamId)
}

export async function syncCooperativeScores(tx: Prisma.TransactionClient, matchId: string, scores: Record<string, number>) {
  const cooperative = await tx.cooperativeMatch.findUnique({ where: { matchId }, select: { id: true } })
  if (!cooperative) return
  const participants = await tx.cooperativeParticipant.findMany({ where: { cooperativeMatchId: cooperative.id }, select: { id: true, matchParticipantId: true, teamId: true } })
  const teamIds = new Set<string>()
  for (const participant of participants) {
    const score = scores[participant.matchParticipantId]
    if (score !== undefined) await tx.cooperativeParticipant.update({ where: { id: participant.id }, data: { finalScore: Math.max(0, Math.trunc(score)) } })
    teamIds.add(participant.teamId)
  }
  for (const teamId of teamIds) await syncCooperativeTeamScore(tx, teamId)
}

async function syncCooperativeTeamScore(tx: Prisma.TransactionClient, teamId: string) {
  const participants = await tx.cooperativeParticipant.findMany({ where: { teamId }, select: { finalScore: true } })
  await tx.cooperativeTeam.update({ where: { id: teamId }, data: { score: participants.reduce((total, participant) => total + participant.finalScore, 0) } })
}
