/**
 * AI 読み取りの結果（ClubTableResult / SchoolCalendarResult）→ ScheduleEventInput。
 * Node 専用の API を使わないので、ブラウザや Cloudflare Workers からも呼べる。
 */
import type { ClubTableResult, SchoolCalendarResult } from './ai/prompts.js';
import { DEFAULT_CLUB_KIND_RULES, DEFAULT_SCHOOL_KIND_RULES, inferKind, parseTimeRange } from './normalize.js';
import type { Kind, ScheduleEventInput, SchoolSettings } from './types.js';
import { DEFAULT_SCHOOL_SETTINGS } from './types.js';
import { currentFiscalYear, parseSheetDate } from './sheet.js';

/**
 * AI の返事の日付を YYYY-MM-DD にそろえる。「4/1」「4月1日」「2026/4/1」「R8.4.1」など。
 * year が分かっていれば（部活の月間表の year）その年、無ければ年度（4 月始まり）から補う。読めなければ undefined。
 */
export function normalizeAiDate(raw: string | null | undefined, opt: { year?: number; fiscalYear?: number }): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const md = s.replace(/[（(].*?[）)]/g, '').match(/^(\d{1,2})[/.\-月](\d{1,2})日?$/);
  if (md && opt.year) {
    const m = +md[1];
    const d = +md[2];
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    return `${opt.year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return parseSheetDate(s, opt.fiscalYear ?? (opt.year ? (opt.year <= 12 ? currentFiscalYear() : opt.year) : currentFiscalYear()));
}

export interface ClubConvertOptions {
  school: string;
  layer: string;
  fileRef: string;
  settings?: SchoolSettings;
  /** 班の別名。例: サテライト → [サテライト県3部, サテライト県4部] */
  categoryAliases?: Record<string, string[]>;
  /** 日付が読めず飛ばしたセルの通知（画面で件数を出す） */
  onSkip?: (cell: { date: string; category: string; text: string }) => void;
}

/**
 * 部活の月間表（日 × 班）の読み取り結果をイベントに。
 * 同じ日に同じ内容（本文・場所）が複数の班にあるセル（横結合の大会日など）は 1 件にまとめ、slots に全部の班を入れる。
 */
export function clubTableToEvents(res: ClubTableResult, o: ClubConvertOptions): ScheduleEventInput[] {
  const events = clubCellsToEvents(res, o);
  const order = res.categories ?? [];
  const groups = new Map<string, ScheduleEventInput>();
  const out: ScheduleEventInput[] = [];
  for (const e of events) {
    // 朝練・学校行事は班ではなく列そのものに意味があるのでまとめない
    if (e.category === '朝練' || e.category === '学校行事') {
      out.push(e);
      continue;
    }
    const key = [e.date, e.title, e.place ?? '', e.kind, e.timeStart ?? ''].join('|');
    const g = groups.get(key);
    if (g) {
      g.slots = [...(g.slots ?? [g.category]), e.category];
    } else {
      groups.set(key, e);
      out.push(e);
    }
  }
  for (const e of out) {
    if (e.slots && e.slots.length > 1) {
      e.slots = [...new Set(e.slots)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      e.category = e.slots[0];
    }
  }
  return out;
}

function clubCellsToEvents(res: ClubTableResult, o: ClubConvertOptions): ScheduleEventInput[] {
  const settings = o.settings ?? DEFAULT_SCHOOL_SETTINGS;
  const out: ScheduleEventInput[] = [];
  const yearHint = res.year && res.year > 1900 ? res.year : undefined;
  for (const c of res.cells) {
    const lines = (c.text ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const text = lines[0] ?? '';
    if (!text) continue;
    const restNote = lines.length > 1 ? lines.slice(1).join(' / ') : undefined;
    const date = normalizeAiDate(c.date, { year: yearHint });
    if (!date) {
      o.onSkip?.(c);
      continue;
    }
    const endRaw = normalizeAiDate(c.end_date ?? undefined, { year: yearHint });
    const endDate = endRaw && endRaw > date ? endRaw : undefined;
    const cats = o.categoryAliases?.[c.category] ?? [c.category];
    for (const category of cats) {
      const base = {
        school: o.school,
        layer: o.layer,
        layerType: 'club' as const,
        category,
        date,
        endDate,
        sourceRef: `${o.fileRef}#${c.date}/${c.category}`,
        note: [restNote, c.highlighted ? '元の表で強調表示' : undefined].filter(Boolean).join(' / ') || undefined,
      };
      if (c.category === '朝練') {
        out.push({ ...base, kind: 'practice', title: `朝練（${text}）` });
        continue;
      }
      if (c.category === '学校行事') {
        const kind: Kind = /考査|テスト/.test(text) ? 'pause:test' : 'event';
        out.push({ ...base, kind, title: text });
        continue;
      }
      let kind = inferKind(text, DEFAULT_CLUB_KIND_RULES, 'event');
      // 学校行事の表（祝日・考査・授業なしなど）を部活の表と同じ指示文で読んだときのために、学校向けの規則も試す
      if (kind === 'event') kind = inferKind(text, DEFAULT_SCHOOL_KIND_RULES, 'event');
      if (/リカバリー/.test(text)) kind = 'event';
      const t = kind === 'practice' || kind === 'match' ? parseTimeRange(text, settings) : {};
      out.push({ ...base, kind, title: text, timeStart: t.start, timeEnd: t.end, place: c.place ?? undefined });
    }
  }
  return out;
}

export interface SchoolConvertOptions {
  school: string;
  layer: string;
  fileRef: string;
  /** 「南:」で始まる項目をこの班に */
  prefixCategories?: Record<string, string>;
}

/** 学校の年間行事予定の読み取り結果をイベントに */
export function schoolItemsToEvents(res: SchoolCalendarResult, o: SchoolConvertOptions): { events: ScheduleEventInput[]; warnings: string[] } {
  const events: ScheduleEventInput[] = [];
  const warnings: string[] = [];
  for (const it of res.items) {
    let text = it.text.trim();
    let category = it.column.trim() || '全校';
    for (const [prefix, cat] of Object.entries(o.prefixCategories ?? {})) {
      if (text.startsWith(prefix)) {
        category = cat;
        text = text.slice(prefix.length).trim();
        break;
      }
    }
    const fy = res.fiscal_year && res.fiscal_year > 1900 ? res.fiscal_year : undefined;
    const date = normalizeAiDate(it.date, { fiscalYear: fy });
    if (!date) {
      warnings.push(`日付が読めません: ${JSON.stringify(it)}`);
      continue;
    }
    const endDate = normalizeAiDate(it.end_date ?? undefined, { fiscalYear: fy });
    events.push({
      school: o.school,
      layer: o.layer,
      layerType: 'school',
      category,
      date,
      endDate: endDate && endDate > date ? endDate : undefined,
      kind: inferKind(text, DEFAULT_SCHOOL_KIND_RULES, 'school_event'),
      title: text,
      note: it.approximate ? '欄外の記載。日付は近似' : undefined,
      confidence: it.approximate ? 0.5 : undefined,
      sourceRef: o.fileRef,
    });
  }
  return { events, warnings };
}
