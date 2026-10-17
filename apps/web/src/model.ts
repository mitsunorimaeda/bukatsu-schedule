/**
 * 画面側のモデル（docs/ux-redesign.md）。
 *  ワークスペース（学校） > カレンダー（DB では layer） > 班（slots） > 予定
 */
import type { Kind, LayerType, SchoolSettings } from '@bukatsu/core/browser';

export type { Kind };

export interface UiEvent {
  /** DB の行 ID（未保存なら無し） */
  id?: string;
  versionId?: string;
  uid: string;
  calendarId: string;
  /** 班。複数なら表で横結合、配信では各班に入る */
  slots: string[];
  date: string;
  endDate?: string;
  kind: Kind;
  timeStart?: string;
  timeEnd?: string;
  place?: string;
  title: string;
  note?: string;
  /** 下書き: 編集者だけに見え、公開されない */
  draft: boolean;
  confidence?: number;
  sourceRef?: string;
}

export interface Version {
  id: string;
  label: string;
  status: 'working' | 'pending' | 'approved' | 'rejected';
  importedAt: string;
  eventCount: number;
  source?: string;
  aiMode?: string;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  type: LayerType;
  slots: string[];
  publishMode: 'auto' | 'manual';
  source: { kind: string; [k: string]: unknown } | null;
  publishedAt?: string;
  versions: Version[];
  /** 編集者が見る内容（手動公開なら working 版、自動なら公開中の版） */
  events: UiEvent[];
  /** 公開中の内容（下書き除く） */
  published: UiEvent[];
  /** 確認待ちの取り込み（あれば） */
  pending?: { version: Version; events: UiEvent[]; changes: Change[] };
  /** 1 つ前の公開版（差分の基準） */
  previous?: { version: Version; events: UiEvent[] };
}

export interface Workspace {
  id: string;
  name: string;
  settings: SchoolSettings;
  calendars: Calendar[];
  role: 'admin' | 'teacher' | 'viewer';
  /** 編集できるカレンダー → 班（null = 全班） */
  grants: Record<string, string[] | null>;
}

export interface Change {
  type: 'added' | 'removed' | 'changed';
  before?: UiEvent;
  after?: UiEvent;
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function daysOf(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}
export function weekday(d: string): number {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).getDay();
}
export function shiftMonth(ym: string, k: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}
export function md(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
export function todayYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function datesBetween(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

export function covers(e: UiEvent, d: string): boolean {
  return e.date <= d && (e.endDate || e.date) >= d;
}
export type SpanPart = 'single' | 'start' | 'mid' | 'end';
export function spanPart(e: UiEvent, d: string): SpanPart {
  if (!e.endDate || e.endDate === e.date) return 'single';
  return d === e.date ? 'start' : d === e.endDate ? 'end' : 'mid';
}
export function dayIndex(e: UiEvent, d: string): number {
  return Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${e.date}T00:00:00`).getTime()) / 86400000) + 1;
}
export function spanDays(e: UiEvent): number {
  return e.endDate ? dayIndex(e, e.endDate) : 1;
}
export function inSlot(e: UiEvent, s: string): boolean {
  return e.slots.includes(s);
}

export interface RowCell {
  slot: string;
  span: number;
  events: UiEvent[];
  /** 班をまたぐ 1 件だけのマス（横結合） */
  shared: boolean;
  /** 別々に保存されているが同じ内容で結合に含めた予定（隣の班の行） */
  siblings?: UiEvent[];
}

/** 同じ予定とみなす鍵（班をまたぐ 1 件、または班ごとに別々に保存された同じ内容） */
const sameKey = (e: UiEvent) => JSON.stringify([e.date, e.endDate ?? '', e.title, e.timeStart ?? '', e.timeEnd ?? '', e.place ?? '', e.kind, e.draft]);

/** 1 日 × 1 カレンダーの列を、結合できる所は結合してマスの並びにする */
export function rowCells(d: string, visibleSlots: string[], events: UiEvent[]): RowCell[] {
  const cells: RowCell[] = [];
  // 同じマスに複数あるときは 終日 → 時刻順
  const at = (s: string) => events.filter((e) => covers(e, d) && inSlot(e, s)).sort((a, b) => (a.timeStart ?? '').localeCompare(b.timeStart ?? ''));
  let i = 0;
  while (i < visibleSlots.length) {
    const list = at(visibleSlots[i]);
    let span = 1;
    const extra: UiEvent[] = [];
    if (list.length === 1) {
      const k = sameKey(list[0]);
      while (i + span < visibleSlots.length) {
        const l2 = at(visibleSlots[i + span]);
        if (l2.length === 1 && (l2[0] === list[0] || sameKey(l2[0]) === k)) {
          if (l2[0] !== list[0]) extra.push(l2[0]);
          span++;
        } else break;
      }
    }
    const shared = span > 1 || (list.length === 1 && list[0].slots.length > 1);
    cells.push({ slot: visibleSlots[i], span, events: list, shared, siblings: extra });
    i += span;
  }
  return cells;
}

/** 公開されている内容 */
export function publicEvents(c: Calendar): UiEvent[] {
  return c.published;
}

const SIG = (e: UiEvent) => JSON.stringify([e.title, e.timeStart, e.timeEnd, e.date, e.endDate, e.place, e.kind, [...e.slots].sort(), e.note]);

/** 公開中との差分（手動公開の「未公開の変更」）。uid で突き合わせる */
export function diffEvents(before: UiEvent[], after: UiEvent[]): Change[] {
  const b = new Map(before.map((e) => [e.uid, e]));
  const a = new Map(after.filter((e) => !e.draft).map((e) => [e.uid, e]));
  const out: Change[] = [];
  for (const [uid, e] of a) {
    const p = b.get(uid);
    if (!p) out.push({ type: 'added', after: e });
    else if (SIG(p) !== SIG(e)) out.push({ type: 'changed', before: p, after: e });
  }
  for (const [uid, p] of b) if (!a.has(uid)) out.push({ type: 'removed', before: p });
  return out.sort((x, y) => (x.after ?? x.before)!.date.localeCompare((y.after ?? y.before)!.date));
}

export function unpublishedChanges(c: Calendar): Change[] {
  if (c.publishMode !== 'manual') return [];
  return diffEvents(c.published, c.events);
}
export function draftCount(c: Calendar): number {
  return c.events.filter((e) => e.draft).length;
}

export function fmtTime(e: Pick<UiEvent, 'timeStart' | 'timeEnd'>): string {
  if (!e.timeStart) return '';
  return e.timeEnd ? `${e.timeStart}〜${e.timeEnd}` : e.timeStart;
}

export function changeLine(x: Change): string {
  const e = (x.after ?? x.before)!;
  const slot = e.slots.length > 1 ? e.slots.join('・') : e.slots[0];
  if (x.type === 'added') return `${md(e.date)} ${slot}: 追加 ${e.title}`;
  if (x.type === 'removed') return `${md(e.date)} ${slot}: 取消 ${e.title}`;
  return `${md(e.date)} ${slot}: ${fmtTime(x.before!)} ${x.before!.title} → ${fmtTime(x.after!)} ${x.after!.title}`;
}

/** 新しい予定の uid。(calendar, 先頭の班, 日, 種類) + ランダムで、同日同種が複数あっても衝突しない */
export function newUid(calendarId: string, e: Pick<UiEvent, 'slots' | 'date' | 'kind'>): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${calendarId}|${e.slots[0]}|${e.date}|${e.kind}|${rnd}@bukatsu-schedule.arca.fit`;
}

/** ワークスペースの ID（英小文字） */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const rnd = Math.random().toString(36).slice(2, 6);
  return (base ? `${base}-${rnd}` : `ws-${Date.now().toString(36)}`).slice(0, 40);
}
