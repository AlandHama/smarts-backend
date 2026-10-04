import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DailyChallengeAttemptStatus, DailyChallengeStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { PrismaService } from "../../prisma.service";
import { GenerateDailyChallengeDto, UpdateDailyChallengeConfigurationDto } from "./dtos";

const challengeInclude = {
  gameDefinition: { select: { key: true, name: true } },
  questions: {
    orderBy: { position: "asc" as const },
    include: { contentItem: { select: { id: true, prompt: true, options: true, answerIndex: true, difficulty: true, category: true } } },
  },
};

@Injectable()
export class DailyChallengeService {
  constructor(private readonly prisma: PrismaService) {}

  async configuration() {
    return this.serialize(await this.prisma.dailyChallengeConfiguration.findUnique({ where: { key: "default" } }));
  }

  async updateConfiguration(dto: UpdateDailyChallengeConfigurationDto) {
    const data = {
      ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
      ...(dto.gameKey === undefined ? {} : { gameKey: dto.gameKey.trim().toLowerCase() }),
      ...(dto.timezone === undefined ? {} : { timezone: dto.timezone.trim() || "UTC" }),
      ...(dto.questionsPerDay === undefined ? {} : { questionsPerDay: dto.questionsPerDay }),
      ...(dto.durationSeconds === undefined ? {} : { durationSeconds: dto.durationSeconds }),
      ...(dto.maxAttempts === undefined ? {} : { maxAttempts: dto.maxAttempts }),
      ...(dto.pointsPerCorrect === undefined ? {} : { pointsPerCorrect: dto.pointsPerCorrect }),
    };
    return this.serialize(await this.prisma.dailyChallengeConfiguration.upsert({
      where: { key: "default" },
      create: { key: "default", ...data },
      update: data,
    }));
  }

  async today(userId: string) {
    const config = await this.enabledConfig();
    const challenge = await this.ensureChallenge(this.todayKey(config.timezone), config, true);
    const attempt = await this.prisma.dailyChallengeAttempt.findUnique({ where: { challengeId_userId: { challengeId: challenge.id, userId } } });
    const attemptedPlayers = await this.prisma.dailyChallengeAttempt.count({ where: { challengeId: challenge.id } });
    return {
      configuration: this.publicConfig(config),
      challenge: this.publicChallenge(challenge),
      attemptedPlayers,
      attempt: attempt ? await this.attemptResult(attempt) : null,
    };
  }

  async start(userId: string) {
    const config = await this.enabledConfig();
    const challenge = await this.ensureChallenge(this.todayKey(config.timezone), config, true);
    let attempt = await this.prisma.dailyChallengeAttempt.findUnique({ where: { challengeId_userId: { challengeId: challenge.id, userId } } });
    if (attempt && attempt.status !== DailyChallengeAttemptStatus.IN_PROGRESS) {
      return { alreadyAttempted: true, challenge: this.publicChallenge(challenge), attempt: await this.attemptResult(attempt) };
    }
    if (!attempt) {
      attempt = await this.prisma.dailyChallengeAttempt.create({
        data: { challengeId: challenge.id, userId, expiresAt: new Date(Date.now() + challenge.durationSeconds * 1000) },
      });
    }
    if (attempt.expiresAt <= new Date()) {
      const expired = await this.finalize(userId, attempt.id, true);
      return { alreadyAttempted: true, challenge: this.publicChallenge(challenge), attempt: await this.attemptResult(expired) };
    }
    return {
      alreadyAttempted: false,
      challenge: this.publicChallenge(challenge, true),
      attempt: { id: attempt.id, startedAt: attempt.startedAt, expiresAt: attempt.expiresAt, answeredQuestions: attempt.answeredQuestions, score: attempt.score },
    };
  }

  async answer(userId: string, attemptId: string, position: number, selectedIndex: number, timeTakenMs?: number) {
    if (!Number.isInteger(position) || position < 0 || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      throw new BadRequestException("Invalid daily challenge answer");
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.dailyChallengeAttempt.findFirst({
        where: { id: attemptId, userId },
        include: { challenge: { include: { questions: { where: { position }, include: { contentItem: { select: { options: true, answerIndex: true } } } } } } },
      });
      if (!attempt) throw new NotFoundException("Daily challenge attempt not found");
      if (attempt.status !== DailyChallengeAttemptStatus.IN_PROGRESS) throw new ConflictException("This daily challenge attempt is closed");
      if (attempt.expiresAt <= new Date()) throw new ConflictException("Time is up");
      const question = attempt.challenge.questions[0];
      if (!question) throw new BadRequestException("Invalid challenge question");
      const options = Array.isArray(question.contentItem.options) ? question.contentItem.options : [];
      if (selectedIndex >= options.length) throw new BadRequestException("Selected answer is out of range");
      const existing = await tx.dailyChallengeAnswer.findUnique({ where: { attemptId_position: { attemptId, position } } });
      if (existing) return { attempt, correct: existing.isCorrect, duplicate: true };
      const correct = selectedIndex === question.contentItem.answerIndex;
      await tx.dailyChallengeAnswer.create({ data: { attemptId, position, selectedIndex, isCorrect: correct, timeTakenMs: timeTakenMs === undefined ? null : Math.max(0, Math.min(3600000, Math.round(timeTakenMs))) } });
      const updated = await tx.dailyChallengeAttempt.update({
        where: { id: attempt.id },
        data: { answeredQuestions: { increment: 1 }, correctAnswers: correct ? { increment: 1 } : undefined, score: correct ? { increment: attempt.challenge.pointsPerCorrect } : undefined },
      });
      return { attempt: updated, correct, duplicate: false };
    });
    return { accepted: true, duplicate: result.duplicate, correct: result.correct, answeredQuestions: result.attempt.answeredQuestions, score: result.attempt.score };
  }

  async complete(userId: string, attemptId: string) {
    return this.attemptResult(await this.finalize(userId, attemptId, false));
  }

  async leaderboard(userId: string, scope: "global" | "friends" = "global", limit = 50) {
    const config = await this.enabledConfig();
    const challenge = await this.ensureChallenge(this.todayKey(config.timezone), config, true);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    let userIds: string[] | undefined;
    if (scope === "friends") {
      const friendships = await this.prisma.friendship.findMany({ where: { OR: [{ userId }, { friendId: userId }] }, select: { userId: true, friendId: true } });
      userIds = Array.from(new Set([userId, ...friendships.flatMap((row) => [row.userId, row.friendId])]));
    }
    const where = { challengeId: challenge.id, status: DailyChallengeAttemptStatus.COMPLETED, ...(userIds ? { userId: { in: userIds } } : {}) };
    const rows = await this.prisma.dailyChallengeAttempt.findMany({
      where,
      orderBy: [{ score: "desc" }, { elapsedMs: "asc" }, { submittedAt: "asc" }],
      take: safeLimit,
      include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, level: true } } } } },
    });
    const current = await this.prisma.dailyChallengeAttempt.findUnique({ where: { challengeId_userId: { challengeId: challenge.id, userId } }, include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, level: true } } } } } });
    const totalCompleted = await this.prisma.dailyChallengeAttempt.count({ where });
    const currentRank = current?.status === DailyChallengeAttemptStatus.COMPLETED ? await this.rankFor(current, where) : null;
    return {
      scope,
      challenge: this.publicChallenge(challenge),
      totalCompleted,
      current: current ? { ...this.publicAttempt(current), rank: currentRank } : null,
      items: rows.map((row, index) => ({ ...this.publicAttempt(row), rank: index + 1 })),
    };
  }

  async adminList(limit = 30) {
    return this.serialize(await this.prisma.dailyChallenge.findMany({
      orderBy: { dateKey: "desc" },
      take: Math.max(1, Math.min(100, Number(limit) || 30)),
      include: { gameDefinition: { select: { key: true, name: true } }, _count: { select: { questions: true, attempts: true } } },
    }));
  }

  async adminGenerate(dto: GenerateDailyChallengeDto) {
    const config = await this.config();
    const dateKey = dto.dateKey?.trim() || this.todayKey(config.timezone);
    this.assertDateKey(dateKey);
    const settings = { ...config, gameKey: dto.gameKey?.trim().toLowerCase() || config.gameKey };
    return this.adminChallenge(await this.ensureChallenge(dateKey, settings, dto.publish !== false));
  }

  async adminGet(dateKey: string) {
    const challenge = await this.prisma.dailyChallenge.findUnique({ where: { dateKey }, include: { ...challengeInclude, _count: { select: { attempts: true } } } });
    if (!challenge) throw new NotFoundException("Daily challenge not found");
    return this.adminChallenge(challenge);
  }

  async adminPublish(dateKey: string) {
    const challenge = await this.prisma.dailyChallenge.update({ where: { dateKey }, data: { status: DailyChallengeStatus.PUBLISHED, publishedAt: new Date() }, include: { ...challengeInclude, _count: { select: { attempts: true } } } });
    return this.adminChallenge(challenge);
  }

  private async finalize(userId: string, attemptId: string, forceExpired: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.dailyChallengeAttempt.findFirst({ where: { id: attemptId, userId }, include: { challenge: true, answers: true } });
      if (!attempt) throw new NotFoundException("Daily challenge attempt not found");
      if (attempt.status !== DailyChallengeAttemptStatus.IN_PROGRESS) return attempt;
      const now = new Date();
      const expired = forceExpired || now > attempt.expiresAt;
      const correctAnswers = attempt.answers.filter((answer) => answer.isCorrect).length;
      const elapsedMs = Math.max(0, Math.min(attempt.challenge.durationSeconds * 1000, now.getTime() - attempt.startedAt.getTime()));
      return tx.dailyChallengeAttempt.update({ where: { id: attempt.id }, data: { status: expired ? DailyChallengeAttemptStatus.EXPIRED : DailyChallengeAttemptStatus.COMPLETED, submittedAt: now, elapsedMs, answeredQuestions: attempt.answers.length, correctAnswers, score: correctAnswers * attempt.challenge.pointsPerCorrect } });
    });
  }

  private async attemptResult(attempt: any) {
    const base = { id: attempt.id, status: attempt.status, score: attempt.score, correctAnswers: attempt.correctAnswers, answeredQuestions: attempt.answeredQuestions, elapsedMs: attempt.elapsedMs, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, expiresAt: attempt.expiresAt };
    if (attempt.status !== DailyChallengeAttemptStatus.COMPLETED) return base;
    const where = { challengeId: attempt.challengeId, status: DailyChallengeAttemptStatus.COMPLETED };
    const rank = await this.rankFor(attempt, where);
    const totalCompleted = await this.prisma.dailyChallengeAttempt.count({ where });
    return { ...base, rank, totalCompleted, beatPercent: totalCompleted ? Math.max(0, Math.round(((totalCompleted - rank) / totalCompleted) * 100)) : 0 };
  }

  private async rankFor(attempt: any, where: any) {
    const better = await this.prisma.dailyChallengeAttempt.count({ where: { ...where, OR: [{ score: { gt: attempt.score } }, { score: attempt.score, elapsedMs: { lt: attempt.elapsedMs ?? 2147483647 } }, { score: attempt.score, elapsedMs: attempt.elapsedMs, submittedAt: { lt: attempt.submittedAt ?? new Date() } }] } });
    return better + 1;
  }

  private async config() {
    const config = await this.prisma.dailyChallengeConfiguration.findUnique({ where: { key: "default" } });
    if (!config) throw new NotFoundException("Daily challenge configuration is missing");
    return config;
  }

  private async enabledConfig() {
    const config = await this.config();
    if (!config.enabled) throw new ConflictException("Daily challenge is currently unavailable");
    return config;
  }

  private async ensureChallenge(dateKey: string, config: any, publish: boolean) {
    this.assertDateKey(dateKey);
    const existing = await this.prisma.dailyChallenge.findUnique({ where: { dateKey }, include: challengeInclude });
    if (existing) {
      if (publish && existing.status === DailyChallengeStatus.DRAFT) return this.prisma.dailyChallenge.update({ where: { id: existing.id }, data: { status: DailyChallengeStatus.PUBLISHED, publishedAt: new Date() }, include: challengeInclude });
      return existing;
    }
    const game = await this.prisma.gameDefinition.findUnique({ where: { key: config.gameKey.trim().toLowerCase() }, select: { id: true, key: true, name: true, active: true } });
    if (!game || !game.active) throw new NotFoundException("Daily challenge game is not active");
    const content = await this.prisma.gameContentItem.findMany({ where: { gameDefinitionId: game.id, active: true }, select: { id: true } });
    if (content.length < config.questionsPerDay) throw new ConflictException("Daily challenge does not have enough active questions");
    const selected = [...content].sort((a, b) => this.seed(dateKey, a.id).localeCompare(this.seed(dateKey, b.id))).slice(0, config.questionsPerDay);
    try {
      return await this.prisma.dailyChallenge.create({
        data: { dateKey, gameDefinitionId: game.id, status: publish ? DailyChallengeStatus.PUBLISHED : DailyChallengeStatus.DRAFT, questionCount: selected.length, durationSeconds: config.durationSeconds, pointsPerCorrect: config.pointsPerCorrect, publishedAt: publish ? new Date() : null, questions: { create: selected.map((item, position) => ({ position, contentItemId: item.id })) } },
        include: challengeInclude,
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      return (await this.prisma.dailyChallenge.findUnique({ where: { dateKey }, include: challengeInclude }))!;
    }
  }

  private publicConfig(config: any) {
    return { enabled: config.enabled, gameKey: config.gameKey, timezone: config.timezone, questionsPerDay: config.questionsPerDay, durationSeconds: config.durationSeconds, maxAttempts: config.maxAttempts, pointsPerCorrect: config.pointsPerCorrect };
  }

  private publicChallenge(challenge: any, includeQuestions = false) {
    return { id: challenge.id, dateKey: challenge.dateKey, status: challenge.status, title: challenge.title, subtitle: challenge.subtitle, questionCount: challenge.questionCount, durationSeconds: challenge.durationSeconds, game: challenge.gameDefinition, questions: includeQuestions ? challenge.questions.map((question: any) => ({ position: question.position, prompt: this.prompt(question.contentItem.prompt), options: this.options(question.contentItem.options) })) : undefined };
  }

  private publicAttempt(attempt: any) {
    return { userId: attempt.userId, username: attempt.user?.profile?.displayName || attempt.user?.username || "Player", avatarUrl: attempt.user?.profile?.avatarUrl ?? null, level: attempt.user?.profile?.level ?? null, score: attempt.score, correctAnswers: attempt.correctAnswers, answeredQuestions: attempt.answeredQuestions, elapsedMs: attempt.elapsedMs };
  }

  private adminChallenge(challenge: any) {
    return this.serialize({ ...challenge, questions: challenge.questions?.map((question: any) => ({ ...question, prompt: this.prompt(question.contentItem?.prompt), options: this.options(question.contentItem?.options), answerIndex: question.contentItem?.answerIndex, difficulty: question.contentItem?.difficulty, category: question.contentItem?.category })) });
  }

  private prompt(value: unknown) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return String(value ?? "");
    const map = value as Record<string, unknown>;
    return ["en", "ckb", "ku", "ar", "tr"].map((key) => map[key]).find((item): item is string => typeof item === "string" && item.trim().length > 0) ?? "";
  }

  private options(value: unknown) {
    return Array.isArray(value) ? value.map((item) => this.prompt(item)) : [];
  }

  private seed(dateKey: string, id: string) {
    return createHash("sha256").update(dateKey + ":" + id).digest("hex");
  }

  private todayKey(timezone: string) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return values.year + "-" + values.month + "-" + values.day;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  private assertDateKey(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("dateKey must use YYYY-MM-DD");
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" || item instanceof Prisma.Decimal ? item.toString() : item)) as T;
  }
}
