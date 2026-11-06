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
    const hint = await this.prisma.dailyHint.findFirst({
      where: { dateKey, active: true },
      select: { id: true, dateKey: true, translations: true },
    });
    if (!hint) return { available: false, dateKey, hint: null };

    const view = await this.prisma.dailyHintView.findUnique({
      where: { hintId_userId: { hintId: hint.id, userId } },
      select: { viewedAt: true },
    });
    const copy = this.selectTranslation(hint.translations, language);
    return {
      available: true,
      dateKey: hint.dateKey,
      hint: {
        id: hint.id,
        title: copy.title,
        body: copy.body,
        alreadyViewed: Boolean(view),
        viewedAt: view?.viewedAt ?? null,
      },
    };
  }

  async markViewed(userId: string, hintId: string) {
    const hint = await this.prisma.dailyHint.findFirst({ where: { id: hintId, active: true }, select: { id: true } });
    if (!hint) throw new NotFoundException("Daily hint not found");
    await this.prisma.dailyHintView.upsert({
      where: { hintId_userId: { hintId, userId } },
      create: { hintId, userId },
      update: { viewedAt: new Date() },
    });
    return { updated: true };
  }

  async adminList(limit = 60) {
    return this.prisma.dailyHint.findMany({
      orderBy: { dateKey: "desc" },
      take: Math.max(1, Math.min(366, Number(limit) || 60)),
      include: { _count: { select: { views: true } } },
    });
  }

  async adminCreate(dto: CreateDailyHintDto) {
    const dateKey = this.validateDateKey(dto.dateKey);
    return this.prisma.dailyHint.create({
      data: {
        dateKey,
        active: dto.active ?? true,
        translations: this.serializeTranslations(dto.translations),
      },
      include: { _count: { select: { views: true } } },
    });
  }

  async adminUpdate(id: string, dto: UpdateDailyHintDto) {
    const data: Prisma.DailyHintUpdateInput = {};
    if (dto.dateKey !== undefined) data.dateKey = this.validateDateKey(dto.dateKey);
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.translations !== undefined) data.translations = this.serializeTranslations(dto.translations);
    return this.prisma.dailyHint.update({
      where: { id },
      data,
      include: { _count: { select: { views: true } } },
    });
  }

  async adminArchive(id: string) {
    return this.prisma.dailyHint.update({ where: { id }, data: { active: false } });
  }

  async forNotification(dateKey = this.todayKey()) {
    const hint = await this.prisma.dailyHint.findFirst({
      where: { dateKey, active: true },
      select: { id: true, dateKey: true, translations: true },
    });
    return hint ? { ...hint, translations: this.parseTranslations(hint.translations) } : null;
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

  private validateDateKey(dateKey: string) {
    const value = dateKey.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("dateKey must use YYYY-MM-DD");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("dateKey is not a valid calendar date");
    return value;
  }

  private todayKey() {
    return new Date().toISOString().slice(0, 10);
  }
}
