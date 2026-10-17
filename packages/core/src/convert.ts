/**
 * AI 読み取りの結果（ClubTableResult / SchoolCalendarResult）→ ScheduleEventInput。
 * Node 専用の API を使わないので、ブラウザや Cloudflare Workers からも呼べる。
 */
import type { ClubTableResult, SchoolCalendarResult } from './ai/prompts.js';
import { DEFAULT_CLUB_KIND_RULES, DEFAULT_SCHOOL_KIND_RULES, inferKind, parseTimeRange } from './normalize.js';
import type { Kind, ScheduleEventInput, SchoolSettings } from './types.js';
import { DEFAULT_SCHOOL_SETTINGS } from './types.js';

export interface ClubConvertOptions {
  school: string;
  layer: string;
  fileRef: string;
  settings?: SchoolSettings;
  /** 班の別名。例: サテライト → [サテライト県3部, サテライト県4部] */
  categoryAliases?: Record<string, string[]>;
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
  for (const c of res.cells) {
    const text = c.text.trim();
    if (!text) continue;
    const cats = o.categoryAliases?.[c.category] ?? [c.category];
    for (const category of cats) {
      const base = {
        school: o.school,
        layer: o.layer,
        layerType: 'club' as const,
        category,
        date: c.date,
        sourceRef: `${o.fileRef}#${c.date}/${c.category}`,
        note: c.highlighted ? '元の表で強調表示' : undefined,
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) {
      warnings.push(`日付が不正: ${JSON.stringify(it)}`);
      continue;
    }
    events.push({
      school: o.school,
      layer: o.layer,
      layerType: 'school',
      category,
      date: it.date,
      endDate: it.end_date ?? undefined,
      kind: inferKind(text, DEFAULT_SCHOOL_KIND_RULES, 'school_event'),
      title: text,
      note: it.approximate ? '欄外の記載。日付は近似' : undefined,
      confidence: it.approximate ? 0.5 : undefined,
      sourceRef: o.fileRef,
    });
  }
  return { events, warnings };
}
