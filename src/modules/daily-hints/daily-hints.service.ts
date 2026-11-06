import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma.service";
import { CreateDailyHintDto, UpdateDailyHintDto } from "./dtos";

type HintCopy = { title: string; body: string };
type HintTranslations = Record<string, HintCopy>;

const LANGUAGES = ["en", "ar", "ku", "tr"] as const;

@Injectable()
export class DailyHintsService {
  constructor(private readonly prisma: PrismaService) {}

  async today(userId: string, language?: string) {
    const dateKey = this.todayKey();
    const selection = await this.selectionForDate(dateKey);
    if (!selection) return { available: false, dateKey, hint: null };

    const view = await this.prisma.dailyHintView.findUnique({
      where: { dateKey_userId: { dateKey, userId } },
      select: { viewedAt: true },
    });
    const copy = this.selectTranslation(selection.hint.translations, language);
    return {
      available: true,
      dateKey,
      hint: {
        id: selection.hint.id,
        title: copy.title,
        body: copy.body,
        alreadyViewed: Boolean(view),
        viewedAt: view?.viewedAt ?? null,
      },
    };
  }

  async markViewed(userId: string, hintId: string) {
    const dateKey = this.todayKey();
    const selection = await this.selectionForDate(dateKey);
    if (!selection || selection.hint.id !== hintId) throw new NotFoundException("Daily hint is not active today");
    await this.prisma.dailyHintView.upsert({
      where: { dateKey_userId: { dateKey, userId } },
      create: { dateKey, hintId, userId },
      update: { viewedAt: new Date() },
    });
    return { updated: true };
  }

  async adminList(limit = 60) {
    return this.prisma.dailyHint.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(366, Number(limit) || 60)),
      include: { _count: { select: { views: true, selections: true } } },
    });
  }

  async adminCreate(dto: CreateDailyHintDto) {
    return this.prisma.dailyHint.create({
      data: {
        active: dto.active ?? true,
        translations: this.serializeTranslations(dto.translations),
      },
      include: { _count: { select: { views: true, selections: true } } },
    });
  }

  async adminUpdate(id: string, dto: UpdateDailyHintDto) {
    const data: Prisma.DailyHintUpdateInput = {};
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.translations !== undefined) data.translations = this.serializeTranslations(dto.translations);
    return this.prisma.dailyHint.update({
      where: { id },
      data,
      include: { _count: { select: { views: true, selections: true } } },
    });
  }

  async adminArchive(id: string) {
    return this.prisma.dailyHint.update({ where: { id }, data: { active: false } });
  }

  async forNotification(dateKey = this.todayKey()) {
    const selection = await this.selectionForDate(dateKey);
    if (!selection) return null;
    return {
      id: selection.hint.id,
      dateKey,
      translations: this.parseTranslations(selection.hint.translations),
    };
  }

  /**
   * Select one active hint for the UTC day and persist the choice. The unique
   * date key makes this safe when the API and notification worker initialize
   * the day concurrently; the losing request simply reads the winner's row.
   */
  private async selectionForDate(dateKey: string) {
    const existing = await this.prisma.dailyHintSelection.findUnique({
      where: { dateKey },
      include: { hint: { select: { id: true, translations: true } } },
    });
    if (existing) return existing;

    const activeHints = await this.prisma.dailyHint.findMany({
      where: { active: true },
      select: { id: true, translations: true },
    });
    if (!activeHints.length) return null;

    // Avoid repeating yesterday's hint when the pool contains another choice.
    const previous = await this.prisma.dailyHintSelection.findFirst({
      where: { dateKey: { lt: dateKey } },
      orderBy: { dateKey: "desc" },
      select: { hintId: true },
    });
    const candidates = activeHints.length > 1 && previous
      ? activeHints.filter((hint) => hint.id !== previous.hintId)
      : activeHints;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? activeHints[0];

    try {
      return await this.prisma.dailyHintSelection.create({
        data: { dateKey, hintId: chosen.id },
        include: { hint: { select: { id: true, translations: true } } },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      return this.prisma.dailyHintSelection.findUnique({
        where: { dateKey },
        include: { hint: { select: { id: true, translations: true } } },
      });
    }
  }

  selectTranslation(translations: unknown, language?: string): HintCopy {
    const copies = this.parseTranslations(translations);
    const normalized = this.normalizeLanguage(language);
    return copies[normalized] ?? copies.en ?? Object.values(copies)[0] ?? {
      title: "Daily hint",
      body: "Keep playing and look for the pattern.",
    };
  }

  normalizeLanguage(language?: string) {
    const normalized = (language ?? "en").trim().toLowerCase().split(/[-_]/)[0];
    return (LANGUAGES as readonly string[]).includes(normalized) ? normalized : "en";
  }

  private parseTranslations(input: unknown): HintTranslations {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const source = input as Record<string, unknown>;
    const result: HintTranslations = {};
    for (const language of LANGUAGES) {
      const value = source[language];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const copy = value as Record<string, unknown>;
      const title = typeof copy.title === "string" ? copy.title.trim() : "";
      const body = typeof copy.body === "string" ? copy.body.trim() : "";
      if (title && body) result[language] = { title, body };
    }
    return result;
  }

  private serializeTranslations(input: unknown): Prisma.InputJsonValue {
    const parsed = this.parseTranslations(input);
    if (!Object.keys(parsed).length) throw new BadRequestException("At least one complete daily hint translation is required");
    return parsed as Prisma.InputJsonValue;
  }

  private todayKey() {
    return new Date().toISOString().slice(0, 10);
  }
}
