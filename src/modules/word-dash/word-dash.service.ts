import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { MatchParticipantResult, Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma.service"
import { SettleMatchTransaction } from "../matches/transactions/settle-match-transaction"
import { FraudService } from "../fraud/fraud.service"
import { WordDashSubmissionDto } from "./dtos/word-dash.dto"
import { generateWordDashBoard, WordDashBoard } from "./engine/word-dash-board-generator"
import { WordDashDictionary } from "./engine/word-dash-dictionary"
import { WordDashEngine, WordDashPlayerState } from "./engine/word-dash-engine"
import { DEFAULT_WORD_DASH_POLICY, WordDashPolicy } from "./engine/word-dash-score"

type MatchRow = any
type StateRow = any

@Injectable()
export class WordDashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settleMatch: SettleMatchTransaction,
    private readonly fraud: FraudService,
    private readonly dictionary: WordDashDictionary,
  ) {}

  async snapshot(userId: string, matchId: string): Promise<any> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      let wordDash = await this.ensureState(tx, match, policy)
      if (match.status === "STARTED" && wordDash.startedAt) wordDash = await this.advanceBot(tx, match, wordDash, policy, Date.now())
      if (wordDash.endsAt && Date.now() >= wordDash.endsAt.getTime() && match.status === "STARTED") {
        await this.finish(tx, match, wordDash, null, policy)
        match = await this.loadMatch(tx, matchId)
        wordDash = await tx.wordDashMatch.findUniqueOrThrow({ where: { matchId } })
        return { projection: await this.project(tx, match, wordDash, participant.id, policy), finalized: true }
      }
      return { projection: await this.project(tx, match, wordDash, participant.id, policy), finalized: false }
    })
    if (result.finalized) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    return result.projection
  }

  async start(userId: string, matchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (!["CREATED", "STARTED"].includes(match.status)) throw new ConflictException("The match cannot be started")
      const policy = this.policy(match)
      let wordDash = await this.ensureState(tx, match, policy)
      const now = new Date()
      await tx.matchParticipant.update({ where: { id: participant.id }, data: { readyAt: participant.readyAt ?? now } })
      const readiness = await tx.matchParticipant.findMany({ where: { matchId }, select: { id: true, participantType: true, readyAt: true } })
      const ready = readiness.filter((item: any) => item.participantType === "BOT" || item.readyAt !== null)
      const existingStarted = Boolean(wordDash.startedAt)
      if (ready.length < readiness.length && !existingStarted) return { ...await this.project(tx, match, wordDash, participant.id, policy), waitingForPlayers: true, readyCount: ready.length, requiredCount: readiness.length }
      const startedAt = wordDash.startedAt ?? now
      const endsAt = wordDash.endsAt ?? new Date(startedAt.getTime() + policy.durationSeconds * 1000)
      if (!existingStarted) {
        wordDash = await tx.wordDashMatch.update({ where: { matchId }, data: { startedAt, endsAt } })
        await tx.match.update({ where: { id: matchId }, data: { status: "STARTED", startedAt } })
        await tx.matchRound.updateMany({ where: { matchId, status: "CREATED" }, data: { status: "STARTED", startedAt } })
        await tx.analyticsEvent.create({ data: { eventName: "WORD_DASH_MATCH_STARTED", occurredAt: now, matchId, playerId: participant.userId ?? undefined, properties: { rulesVersion: policy.rulesVersion, dictionaryVersion: policy.dictionaryVersion, boardSize: policy.boardSize, durationSeconds: policy.durationSeconds, mode: match.mode } as Prisma.InputJsonValue } })
      }
      return this.project(tx, { ...match, status: "STARTED", startedAt }, wordDash, participant.id, policy)
    })
  }

  async submit(userId: string, matchId: string, dto: WordDashSubmissionDto) {
    const response = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      let match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      if (match.status !== "STARTED") throw new ConflictException("The Word Dash match is not active")
      const policy = this.policy(match)
      let wordDash = await this.ensureState(tx, match, policy)
      const state = await tx.wordDashParticipantState.findUnique({ where: { matchParticipantId: participant.id } })
      if (!state) throw new ConflictException("The Word Dash player state is unavailable")
      const existing = await tx.wordDashSubmission.findFirst({ where: { matchId, matchParticipantId: participant.id, clientSubmissionId: dto.clientSubmissionId }, orderBy: { serverReceivedAt: "desc" } })
      if (existing) return { projection: await this.project(tx, match, wordDash, participant.id, policy), submission: this.submissionProjection(existing, state.score), finalized: false }
      if (dto.sequence !== state.nextSequence) throw new ConflictException("Submission sequence is out of date; reconcile the match")
      const now = Date.now()
      if (wordDash.endsAt && now >= wordDash.endsAt.getTime()) {
        await this.finish(tx, match, wordDash, null, policy)
        match = await this.loadMatch(tx, matchId)
        wordDash = await tx.wordDashMatch.findUniqueOrThrow({ where: { matchId } })
        return { projection: await this.project(tx, match, wordDash, participant.id, policy), finalized: true }
      }
      const recentCount = await tx.wordDashSubmission.count({ where: { matchId, matchParticipantId: participant.id, serverReceivedAt: { gte: new Date(now - 1000) } } })
      if (recentCount >= policy.maxSubmissionsPerSecond) {
        void this.fraud.observe(userId, { type: "WORD_DASH_RATE_LIMITED", sourceType: "WORD_DASH", sourceId: `${matchId}:${participant.id}:${dto.clientSubmissionId}`, metadata: { matchId, sequence: dto.sequence } }).catch(() => undefined)
        return { projection: await this.project(tx, match, wordDash, participant.id, policy), submission: { accepted: false, sequence: dto.sequence, scoreDelta: 0, totalScore: state.score, combo: state.combo, comboLabel: null, reason: "RATE_LIMITED" }, finalized: false }
      }
      if (state.acceptedWordCount >= policy.maxAcceptedWordsPerPlayer) {
        const rejected = await this.recordRejected(tx, match, participant.id, dto, "WORD_LIMIT_REACHED", state)
        return { projection: await this.project(tx, match, wordDash, participant.id, policy), submission: this.submissionProjection(rejected, state.score), finalized: false }
      }
      const board = this.boardFromRecord(wordDash, policy)
      const current: WordDashPlayerState = this.toPlayerState(state)
      const engine = new WordDashEngine(board.letters, policy)
      const validation = engine.validatePath(dto.tileIndexes)
      const word = validation ? null : dto.tileIndexes.map((index) => board.letters[index]).join("")
      // The submitted path is authoritative for board membership. Do not
      // depend on the generated valid-word map here: that map is intentionally
      // bounded for generation/runtime safety and could omit a legitimate
      // dictionary word on a dense board.
      const validWord = word ? this.dictionary.has(word) : false
      const duplicate = word ? await tx.wordDashFoundWord.findFirst({ where: { matchParticipantId: participant.id, word } }) : null
      const reason = dto.boardHashBefore && dto.boardHashBefore !== wordDash.boardHash
        ? "BOARD_MISMATCH"
        : validation ?? (!validWord ? "INVALID_WORD" : duplicate ? "DUPLICATE_WORD" : null)
      const clientReleasedAt = dto.clientReleasedAt && !Number.isNaN(Date.parse(dto.clientReleasedAt)) ? new Date(dto.clientReleasedAt) : undefined
      if (reason) {
        const rejected = await this.recordRejected(tx, match, participant.id, dto, reason, state, clientReleasedAt)
        return { projection: await this.project(tx, match, wordDash, participant.id, policy), submission: this.submissionProjection(rejected, state.score), finalized: false }
      }
      const result = engine.resolve(dto.tileIndexes, current, now)
      const accepted = await this.recordAccepted(tx, match, wordDash, participant.id, dto, state, result, clientReleasedAt)
      wordDash = await tx.wordDashMatch.findUniqueOrThrow({ where: { matchId } })
      const updatedState = await tx.wordDashParticipantState.findUniqueOrThrow({ where: { matchParticipantId: participant.id } })
      return { projection: await this.project(tx, match, wordDash, participant.id, policy), submission: this.submissionProjection(accepted, updatedState.score), finalized: false }
    })
    if (response.finalized) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    return { ...response.projection, submission: response.submission }
  }

  async forfeit(userId: string, matchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockMatch(tx, matchId)
      const match = await this.loadMatch(tx, matchId)
      const participant = this.authorize(match, userId)
      const policy = this.policy(match)
      const wordDash = await this.ensureState(tx, match, policy)
      if (!["CREATED", "STARTED"].includes(match.status)) return this.project(tx, match, wordDash, participant.id, policy)
      await this.finish(tx, match, wordDash, participant.id, policy)
      const finishedMatch = await this.loadMatch(tx, matchId)
      const finishedState = await tx.wordDashMatch.findUniqueOrThrow({ where: { matchId } })
      return { ...(await this.project(tx, finishedMatch, finishedState, participant.id, policy)), finalized: true }
    })
    if ((result as any).finalized) {
      await this.settleFinishedMatch(matchId)
      return this.snapshot(userId, matchId)
    }
    return result
  }

  async finalizeExpiredMatches() {
    const active = await this.prisma.match.findMany({ where: { gameDefinition: { key: "word_dash" }, status: "STARTED" }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { startedAt: "asc" }, take: 100 })
    let finalized = 0
    for (const match of active) {
      const userId = match.participants[0]?.userId
      if (!userId) continue
      try { const projection = await this.snapshot(userId, match.id); if (["FINISHED", "REVIEW", "SETTLED"].includes(projection.status)) finalized += 1 } catch { /* next worker tick retries a concurrent match */ }
    }
    return { finalized }
  }

  async retryPendingSettlements() {
    const pending = await this.prisma.match.findMany({ where: { gameDefinition: { key: "word_dash" }, status: { in: ["FINISHED", "REVIEW"] }, settlement: null }, select: { id: true, participants: { where: { participantType: "PLAYER", userId: { not: null } }, select: { userId: true }, take: 1 } }, orderBy: { endedAt: "asc" }, take: 100 })
    let settled = 0
    for (const match of pending) if (match.participants[0]?.userId) { const result = await this.settleFinishedMatch(match.id); if (result?.status === "SETTLED") settled += 1 }
    return { settled }
  }

  async retrySettlement(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, gameDefinition: { key: "word_dash" } }, select: { id: true, status: true } })
    if (!match) throw new NotFoundException("Word Dash match not found")
    if (!["FINISHED", "REVIEW", "SETTLED"].includes(match.status)) throw new ConflictException("Only finished Word Dash matches can be settled")
    if (match.status !== "SETTLED") await this.settleFinishedMatch(matchId)
    return this.prisma.matchSettlement.findUnique({ where: { matchId } })
  }

  private async recordAccepted(tx: Prisma.TransactionClient, match: MatchRow, wordDash: any, participantId: string, dto: WordDashSubmissionDto, state: StateRow, result: any, clientReleasedAt?: Date) {
    const now = new Date()
    const nextState = { score: result.totalScore, combo: result.combo, bestCombo: Math.max(state.bestCombo, result.combo), acceptedWordCount: state.acceptedWordCount + 1, longestWordLength: Math.max(state.longestWordLength, result.length ?? 0), lastAcceptedAt: now, nextSequence: state.nextSequence + 1, lastSubmissionAt: now }
    const submission = await tx.wordDashSubmission.create({ data: { matchId: match.id, matchParticipantId: participantId, sequence: dto.sequence, clientSubmissionId: dto.clientSubmissionId, tileIndexes: dto.tileIndexes as Prisma.InputJsonValue, reconstructedWord: result.word, accepted: true, scoreDelta: result.scoreDelta, comboAfter: result.combo, clientReleasedAt } })
    await tx.wordDashFoundWord.create({ data: { matchParticipantId: participantId, word: result.word, firstSequence: dto.sequence, scoreDelta: result.scoreDelta, path: dto.tileIndexes as Prisma.InputJsonValue, acceptedAt: now } })
    await tx.wordDashParticipantState.update({ where: { id: state.id }, data: nextState })
    await tx.matchEvent.create({ data: { matchId: match.id, participantId, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientSubmissionId, payload: { game: "word_dash", eventKind: "WORD_SUBMISSION", length: result.length, scoreDelta: result.scoreDelta, combo: result.combo, comboLabel: result.comboLabel } as Prisma.InputJsonValue, accepted: true, clientOccurredAt: clientReleasedAt } })
    return submission
  }

  private async recordRejected(tx: Prisma.TransactionClient, match: MatchRow, participantId: string, dto: WordDashSubmissionDto, reason: string, state: StateRow, clientReleasedAt?: Date) {
    const submission = await tx.wordDashSubmission.create({ data: { matchId: match.id, matchParticipantId: participantId, sequence: dto.sequence, clientSubmissionId: dto.clientSubmissionId, tileIndexes: dto.tileIndexes as Prisma.InputJsonValue, accepted: false, rejectionReason: reason, clientReleasedAt } })
    await tx.wordDashParticipantState.update({ where: { id: state.id }, data: { nextSequence: state.nextSequence + 1, lastSubmissionAt: new Date() } })
    await tx.matchEvent.create({ data: { matchId: match.id, participantId, eventType: "SCORE_UPDATE", sequence: dto.sequence, clientEventId: dto.clientSubmissionId, payload: { game: "word_dash", eventKind: "WORD_SUBMISSION", accepted: false, reason } as Prisma.InputJsonValue, accepted: false, rejectionReason: reason, clientOccurredAt: clientReleasedAt } })
    return submission
  }

  private async finish(tx: Prisma.TransactionClient, match: MatchRow, wordDash: any, forfeitingParticipantId: string | null, policy: WordDashPolicy) {
    const states = await tx.wordDashParticipantState.findMany({ where: { wordDashMatchId: wordDash.id } })
    const scores = match.participants.map((item: any) => ({ id: item.id, score: states.find((state: any) => state.matchParticipantId === item.id)?.score ?? 0 }))
    const winner = forfeitingParticipantId ? scores.find((item: any) => item.id !== forfeitingParticipantId)?.id ?? null : [...scores].sort((first, second) => second.score - first.score)[0]?.id ?? null
    const tied = !forfeitingParticipantId && scores.length > 1 && scores.every((item: any) => item.score === scores[0].score)
    const endedAt = new Date()
    await tx.match.update({ where: { id: match.id }, data: { status: "FINISHED", endedAt } })
    await tx.wordDashMatch.update({ where: { id: wordDash.id }, data: { endedAt } })
    await tx.matchRound.updateMany({ where: { matchId: match.id, status: { in: ["CREATED", "STARTED"] } }, data: { status: "FINISHED", endedAt } })
    for (const item of match.participants) {
      const result: MatchParticipantResult = forfeitingParticipantId === item.id ? "FORFEIT" : tied ? "DRAW" : item.id === winner ? "WIN" : "LOSS"
      await tx.matchParticipant.update({ where: { id: item.id }, data: { finalScore: states.find((state: any) => state.matchParticipantId === item.id)?.score ?? 0, result, submittedAt: endedAt } })
    }
    await tx.analyticsEvent.create({ data: { eventName: "WORD_DASH_MATCH_FINISHED", occurredAt: endedAt, matchId: match.id, properties: { winnerParticipantId: tied ? null : winner, scores, policyVersion: policy.rulesVersion, dictionaryVersion: policy.dictionaryVersion, submissionCount: await tx.wordDashSubmission.count({ where: { matchId: match.id } }) } as Prisma.InputJsonValue } })
  }

  private async settleFinishedMatch(matchId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockMatch(tx, matchId)
        const match = await this.loadMatch(tx, matchId)
        if (match.status !== "FINISHED" || match.settlement) return match.settlement?.settlementJson ?? null
        const human = match.participants.find((item: any) => item.participantType === "PLAYER" && item.userId)
        if (!human?.userId) return null
        const settlement = await this.settleMatch.runWithinTransaction({ matchId, userId: human.userId, idempotencyKey: `word-dash-settle:${matchId}` }, tx)
        await tx.match.update({ where: { id: matchId }, data: { status: settlement?.status === "SETTLED" ? "SETTLED" : undefined } })
        await tx.analyticsEvent.create({ data: { eventName: "WORD_DASH_MATCH_SETTLED", occurredAt: new Date(), matchId, playerId: human.userId, properties: { settlementStatus: settlement?.status ?? "UNKNOWN" } as Prisma.InputJsonValue } })
        return settlement
      })
    } catch {
      return null
    }
  }

  private async advanceBot(tx: Prisma.TransactionClient, match: MatchRow, wordDash: any, policy: WordDashPolicy, nowMs: number) {
    const bot = match.participants.find((item: any) => item.participantType === "BOT")
    if (!bot || !policy.bot.enabled) return wordDash
    const state = await tx.wordDashParticipantState.findUnique({ where: { matchParticipantId: bot.id } })
    if (!state || state.acceptedWordCount >= policy.bot.maxWords) return wordDash
    if (state.lastSubmissionAt && nowMs - state.lastSubmissionAt.getTime() < policy.bot.reactionDelayMs) return wordDash
    const board = this.boardFromRecord(wordDash, policy)
    const found = await tx.wordDashFoundWord.findMany({ where: { matchParticipantId: bot.id }, select: { word: true } })
    const foundSet = new Set(found.map((item: any) => item.word))
    const choices = [...board.validWords.entries()].filter(([word]) => word.length <= policy.bot.maxWordLength && !foundSet.has(word)).sort((first, second) => second[0].length - first[0].length)
    const candidate = choices[state.acceptedWordCount % Math.max(1, choices.length)]
    if (!candidate) return wordDash
    const engine = new WordDashEngine(board.letters, policy)
    const result = engine.resolve(candidate[1], this.toPlayerState(state), nowMs)
    if (!result.accepted || !result.word) return wordDash
    const dto = { sequence: state.nextSequence, clientSubmissionId: `bot:${match.id}:${state.nextSequence}`, tileIndexes: candidate[1] } as WordDashSubmissionDto
    await this.recordAccepted(tx, match, wordDash, bot.id, dto, state, result)
    return tx.wordDashMatch.findUniqueOrThrow({ where: { matchId: match.id } })
  }

  private async project(tx: Prisma.TransactionClient, match: MatchRow, wordDash: any, participantId: string, policy: WordDashPolicy) {
    const states = await tx.wordDashParticipantState.findMany({ where: { wordDashMatchId: wordDash.id } })
    const self = states.find((item: any) => item.matchParticipantId === participantId)
    if (!self) throw new ConflictException("The Word Dash player state is unavailable")
    const opponentParticipant = match.participants.find((item: any) => item.id !== participantId)
    const opponent = opponentParticipant ? states.find((item: any) => item.matchParticipantId === opponentParticipant.id) : null
    const acceptedWords = await tx.wordDashFoundWord.findMany({ where: { matchParticipantId: participantId }, orderBy: { firstSequence: "asc" }, take: policy.maxAcceptedWordsPerPlayer, select: { word: true, path: true, scoreDelta: true, acceptedAt: true } })
    const ownWords = [...acceptedWords].reverse().slice(0, 20)
    const submissions = await tx.wordDashSubmission.findMany({ where: { matchId: match.id, accepted: true }, orderBy: { serverReceivedAt: "desc" }, take: 20, select: { matchParticipantId: true, reconstructedWord: true, scoreDelta: true, comboAfter: true, serverReceivedAt: true } })
    const finished = ["FINISHED", "REVIEW", "SETTLED"].includes(match.status)
    const result = finished ? await this.resultWords(tx, wordDash, match, participantId) : null
    const publicEvents = submissions.reverse().map((item: any) => ({ participantId: item.matchParticipantId, type: item.matchParticipantId === participantId ? "WORD" : "WORD_LENGTH", ...(item.matchParticipantId === participantId ? { word: item.reconstructedWord } : { length: item.reconstructedWord?.length ?? 0 }), scoreDelta: item.scoreDelta, combo: item.comboAfter, at: item.serverReceivedAt }))
    const remaining = wordDash.endsAt ? Math.max(0, wordDash.endsAt.getTime() - Date.now()) : 0
    return {
      matchId: match.id,
      gameKey: "word_dash",
      status: match.status,
      mode: match.mode,
      board: wordDash.boardLetters.split(""),
      boardSize: policy.boardSize,
      minimumWordLength: policy.minimumWordLength,
      durationSeconds: wordDash.durationSeconds,
      startedAt: wordDash.startedAt,
      endsAt: wordDash.endsAt,
      serverNow: new Date().toISOString(),
      remainingMilliseconds: remaining,
      boardHash: wordDash.boardHash,
      rulesVersion: wordDash.rulesVersion,
      dictionaryVersion: wordDash.dictionaryVersion,
      dictionarySha256: wordDash.dictionarySha256,
      selfParticipantId: participantId,
      self: { score: self.score, combo: self.combo, bestCombo: self.bestCombo, acceptedWordCount: self.acceptedWordCount, longestWordLength: self.longestWordLength, nextSequence: self.nextSequence, recentWords: ownWords.map((item: any) => ({ word: item.word, scoreDelta: item.scoreDelta, acceptedAt: item.acceptedAt })), acceptedWords: acceptedWords.map((item: any) => ({ word: item.word, path: Array.isArray(item.path) ? item.path : [], scoreDelta: item.scoreDelta, acceptedAt: item.acceptedAt })) },
      opponent: opponentParticipant ? { participantId: opponentParticipant.id, userId: opponentParticipant.userId, name: opponentParticipant.user?.profile?.displayName ?? opponentParticipant.user?.username ?? "SMARTS bot", username: opponentParticipant.user?.username ?? null, avatarUrl: opponentParticipant.user?.profile?.avatarUrl ?? null, score: opponent?.score ?? 0, combo: opponent?.combo ?? 0, acceptedWordCount: opponent?.acceptedWordCount ?? 0, longestWordLength: opponent?.longestWordLength ?? 0, participantType: opponentParticipant.participantType } : null,
      recentEvents: publicEvents,
      result,
    }
  }

  private async resultWords(tx: Prisma.TransactionClient, wordDash: any, match: MatchRow, participantId: string) {
    const policy = this.policy(match)
    const board = this.boardFromRecord(wordDash, policy)
    const allWords = [...board.validWords.keys()]
    const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true } })
    const found = new Map<string, Set<string>>()
    for (const item of participants) {
      const words = await tx.wordDashFoundWord.findMany({ where: { matchParticipantId: item.id }, select: { word: true } })
      found.set(item.id, new Set(words.map((word: any) => word.word)))
    }
    const own = found.get(participantId) ?? new Set<string>()
    const opponent = [...found.entries()].find(([id]) => id !== participantId)?.[1] ?? new Set<string>()
    const onlyYouFound = [...own].filter((word) => !opponent.has(word)).sort()
    const missed = allWords.filter((word) => !own.has(word)).sort((first, second) => second.length - first.length || first.localeCompare(second))
    return { onlyYouFound: onlyYouFound.slice(0, 10), onlyYouFoundTotal: onlyYouFound.length, missed: missed.slice(0, 10), missedTotal: missed.length, practice: match.mode === "PRACTICE" }
  }

  private async ensureState(tx: Prisma.TransactionClient, match: MatchRow, policy: WordDashPolicy) {
    const existing = await tx.wordDashMatch.findUnique({ where: { matchId: match.id } })
    if (existing) {
      const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true } })
      for (const participant of participants) await tx.wordDashParticipantState.upsert({ where: { matchParticipantId: participant.id }, create: { wordDashMatchId: existing.id, matchParticipantId: participant.id }, update: {} })
      if (match.status === "STARTED" && !existing.startedAt) {
        const startedAt = match.startedAt ?? new Date()
        return tx.wordDashMatch.update({ where: { id: existing.id }, data: { startedAt, endsAt: new Date(startedAt.getTime() + policy.durationSeconds * 1000) } })
      }
      return existing
    }
    const board = generateWordDashBoard(match.serverNonce, policy, this.dictionary)
    const created = await tx.wordDashMatch.create({ data: { matchId: match.id, seed: match.serverNonce, boardLetters: board.letters, boardHash: board.boardHash, rulesVersion: policy.rulesVersion, dictionaryVersion: this.dictionary.version, dictionarySha256: this.dictionary.sha256, durationSeconds: policy.durationSeconds } })
    const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true } })
    for (const participant of participants) await tx.wordDashParticipantState.create({ data: { wordDashMatchId: created.id, matchParticipantId: participant.id } })
    return created
  }

  private boardFromRecord(wordDash: any, policy: WordDashPolicy): WordDashBoard {
    const validWords = this.dictionary.findWordsOnBoard(wordDash.boardLetters, policy.boardSize, policy.minimumWordLength, policy.allowDiagonal)
    return { seed: wordDash.seed, letters: wordDash.boardLetters, boardHash: wordDash.boardHash, validWords: new Map(validWords.map((item) => [item.word, item.path])) }
  }

  private policy(match: MatchRow): WordDashPolicy {
    const settings = match.gameConfig?.settings && typeof match.gameConfig.settings === "object" && !Array.isArray(match.gameConfig.settings) ? match.gameConfig.settings as Record<string, unknown> : {}
    const configured = settings.wordDashPolicy && typeof settings.wordDashPolicy === "object" && !Array.isArray(settings.wordDashPolicy) ? settings.wordDashPolicy as Record<string, any> : {}
    return { ...DEFAULT_WORD_DASH_POLICY, ...configured, dictionaryVersion: this.dictionary.version, scoreTable: { ...DEFAULT_WORD_DASH_POLICY.scoreTable, ...(configured.scoreTable ?? {}) }, comboBonuses: { ...DEFAULT_WORD_DASH_POLICY.comboBonuses, ...(configured.comboBonuses ?? {}) }, bot: { ...DEFAULT_WORD_DASH_POLICY.bot, ...(configured.bot ?? {}) } }
  }

  private async loadMatch(tx: Prisma.TransactionClient, matchId: string): Promise<MatchRow> {
    const match = await tx.match.findUnique({ where: { id: matchId }, include: { gameDefinition: true, gameConfig: true, settlement: true, participants: { include: { user: { include: { profile: true } } } } } })
    if (!match) throw new NotFoundException("Word Dash match not found")
    if (match.gameDefinition.key !== "word_dash") throw new BadRequestException("This is not a Word Dash match")
    return match
  }

  private authorize(match: MatchRow, userId: string) {
    const participant = match.participants.find((item: any) => item.userId === userId)
    if (!participant) throw new NotFoundException("Player is not a participant in this match")
    return participant
  }

  private async lockMatch(tx: Prisma.TransactionClient, matchId: string) { await tx.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE` }

  private toPlayerState(state: StateRow): WordDashPlayerState { return { score: state.score, combo: state.combo, bestCombo: state.bestCombo, acceptedWordCount: state.acceptedWordCount, longestWordLength: state.longestWordLength, lastAcceptedAt: state.lastAcceptedAt?.getTime() ?? null, nextSequence: state.nextSequence } }

  private submissionProjection(submission: any, totalScore?: number) { return { accepted: submission.accepted, sequence: submission.sequence, word: submission.reconstructedWord ?? undefined, length: submission.reconstructedWord?.length, scoreDelta: submission.scoreDelta, totalScore: totalScore ?? undefined, combo: submission.comboAfter, comboLabel: submission.comboAfter >= 8 ? "WORD RUSH" : submission.comboAfter >= 5 ? "COMBO ×3" : submission.comboAfter >= 3 ? "COMBO ×2" : null, reason: submission.rejectionReason ?? undefined } }
}
