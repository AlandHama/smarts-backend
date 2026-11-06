import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class DailyHintTranslationsDto {
  @ApiProperty({
    example: {
      en: { title: "Look for the pattern", body: "The fastest answer is often hidden in the repetition." },
      ar: { title: "ابحث عن النمط", body: "غالباً ما تكون الإجابة الأسرع مخفية في التكرار." },
      ku: { title: "بەدوای نەخشەکە بگەڕێ", body: "زۆرجار وەڵامی خێرا لە دووبارەبوونەوەدا دەشاردرێتەوە." },
      tr: { title: "Deseni ara", body: "En hızlı cevap çoğu zaman tekrarda gizlidir." },
    },
  })
  @IsObject()
  translations!: Record<string, unknown>;
}

export class CreateDailyHintDto extends DailyHintTranslationsDto {
  @ApiProperty({ example: "2026-11-06" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateKey!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDailyHintDto {
  @ApiPropertyOptional({ example: "2026-11-06" })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateKey?: string;

  @ApiPropertyOptional({ type: DailyHintTranslationsDto })
  @IsOptional()
  @IsObject()
  translations?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
