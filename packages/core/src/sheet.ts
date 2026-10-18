/**
 * Google シート / CSV の取り込み（画面から登録する経路）。Node 非依存。
 *  - 公開 CSV の URL（Google シートの「ウェブに公開」や「リンクを知っている全員が閲覧可」のシート、普通の .csv）
 *  - 列の対応（日付・時刻・内容・場所・班・終了日）は先生が先頭の数行を見ながら選ぶ
 *  - 選んだ列だけを使う。選手名などの他の列は保存しない
 */
import type { LayerType, ScheduleEventInput, SchoolSettings } from './types.js';
import { DEFAULT_SCHOOL_SETTINGS } from './types.js';
import { DEFAULT_CLUB_KIND_RULES, DEFAULT_SCHOOL_KIND_RULES, inferKind, normalizeText, parseTimeRange } from './normalize.js';

export interface SheetMapping {
  /** 0 始まりの列番号 */
  date: number;
  /** 内容の列（titles を使うときは titles[0].col と同じ） */
  title: number;
  /**
   * 班ごとに列が分かれている表（日付 × 班）のための、内容の列の一覧。2 列以上のときだけ入る。
   * slot はその列の予定を入れる班。省略時は見出し行の文字、'*' なら全班
   */
  titles?: { col: number; slot?: string }[];
  time?: number;
  place?: number;
  slot?: number;
  endDate?: number;
  /** 先頭の見出し行の数 */
  headerRows: number;
  /** 年が書かれていない日付（10/1 など）の年度。省略時は取り込み時点の年度 */
  fiscalYear?: number;
}
export interface SheetSource {
  kind: 'sheet';
  /** 先生が貼った URL */
  url: string;
  /** 実際に取りに行く CSV の URL */
  csvUrl: string;
  mapping: SheetMapping;
  /** 1 時間ごとの自動更新で変化があったとき: そのまま反映 / 確認待ちにする / 何もしない（既定 apply） */
  auto?: 'apply' | 'pending' | 'off';
  /** 自動更新の記録（サーバーが書く） */
  lastSync?: string;
  lastHash?: string;
  lastCount?: number;
  lastError?: string | null;
  lastChange?: string;
}

/** 取り込み結果の指紋。同じなら版を増やさない */
export function eventsHash(events: ScheduleEventInput[]): string {
  const sig = events
    .map((e) => [e.date, e.endDate ?? '', e.category, (e.slots ?? []).join('・'), e.kind, e.timeStart ?? '', e.timeEnd ?? '', e.place ?? '', e.title, e.note ?? ''].join('|'))
    .sort()
    .join('\n');
  // FNV-1a 32bit × 2（Node 非依存で十分短い）
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < sig.length; i++) {
    const c = sig.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** RFC 4180 風の CSV。引用符・改行入りセル・CRLF・BOM に対応 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // 末尾の空行は落とす
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/** 貼られた URL を CSV の URL に。Google シートの編集 URL は export?format=csv に、公開 URL は output=csv に */
export function normalizeSheetUrl(input: string): { csvUrl: string; kind: 'gsheet' | 'gsheet-pub' | 'csv' } | null {
  const u = input.trim();
  if (!/^https:\/\//i.test(u)) return null;
  const pub = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([^/]+)\/pub/i);
  if (pub) {
    const gid = u.match(/[?&#]gid=(\d+)/)?.[1];
    return { csvUrl: `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`, kind: 'gsheet-pub' };
  }
  const edit = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/i);
  if (edit) {
    const gid = u.match(/[?&#]gid=(\d+)/)?.[1];
    return { csvUrl: `https://docs.google.com/spreadsheets/d/${edit[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`, kind: 'gsheet' };
  }
  return { csvUrl: u, kind: 'csv' };
}

/** 列の見出しから対応を推測する（先生が直す前の初期値） */
export function guessMapping(header: string[] | undefined): Partial<SheetMapping> {
  const m: Partial<SheetMapping> = {};
  if (!header) return m;
  const find = (re: RegExp) => header.findIndex((h) => re.test(normalizeText(h ?? '')));
  const d = find(/日付|^日$|date|月日/i);
  const t = find(/時刻|時間|集合|開始|time/i);
  const ti = find(/内容|予定|練習|メニュー|種目|件名|タイトル|行事|スケジュール|event|title/i);
  const p = find(/場所|会場|place|グラウンド/i);
  const s = find(/^班$|カテゴリ|チーム|対象|グループ|slot/i);
  const e = find(/終了日|最終日|end/i);
  if (d >= 0) m.date = d;
  if (t >= 0) m.time = t;
  if (ti >= 0) m.title = ti;
  if (p >= 0) m.place = p;
  if (s >= 0) m.slot = s;
  if (e >= 0) m.endDate = e;
  return m;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** いまの年度（4 月始まり） */
export function currentFiscalYear(now = new Date()): number {
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
/** 「2026/10/1」「2026-10-01」「10/1(木)」「10月1日」「R8.10.1」などを YYYY-MM-DD に。年が無ければ年度から */
export function parseSheetDate(raw: string, fiscalYear: number): string | undefined {
  const s = normalizeText(raw ?? '').replace(/[（(].*?[）)]/g, '').trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^R\s*(\d{1,2})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/i);
  if (m) return `${2018 + +m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.\-月](\d{1,2})日?/);
  if (m) {
    const mo = +m[1];
    const d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
    return `${mo >= 4 ? fiscalYear : fiscalYear + 1}-${pad(mo)}-${pad(d)}`;
  }
  // Google シートが日付をシリアル値で出すことはないが、念のため
  if (/^\d{5}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  return undefined;
}

export interface SheetConvertOptions {
  school: string;
  layer: string;
  layerType: LayerType;
  /** カレンダーの班。班の列が無ければ全班に入れる */
  slots: string[];
  mapping: SheetMapping;
  settings?: SchoolSettings;
  fileRef: string;
}

/**
 * CSV の行 → 予定。空行・日付の読めない行・内容も時刻も無い行は飛ばす。
 * 内容の列が複数（titles）なら、1 行から列ごとに 1 件ずつ作り、班はその列の slot（省略時は見出しの文字）
 */
export function sheetRowsToEvents(rows: string[][], o: SheetConvertOptions): { events: ScheduleEventInput[]; warnings: string[]; skipped: number } {
  const settings = o.settings ?? DEFAULT_SCHOOL_SETTINGS;
  const m = o.mapping;
  const fy = m.fiscalYear ?? currentFiscalYear();
  const events: ScheduleEventInput[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const cell = (r: string[], i: number | undefined) => (i == null || i < 0 ? '' : normalizeText(r[i] ?? '').trim());
  const wide = !!m.titles && m.titles.length > 1;
  const titleCols: { col: number; slot?: string }[] = wide ? m.titles! : [{ col: m.title }];
  const headerOf = (col: number) => (m.headerRows > 0 ? cell(rows[0] ?? [], col) : '');
  const rules = o.layerType === 'school' ? DEFAULT_SCHOOL_KIND_RULES : DEFAULT_CLUB_KIND_RULES;
  const fallback = o.layerType === 'school' ? 'school_event' : o.layerType === 'external' ? 'external_event' : 'practice';
  for (let i = m.headerRows; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c ?? '').trim() === '')) continue;
    const date = parseSheetDate(cell(r, m.date), fy);
    const timeText = cell(r, m.time);
    const anyTitle = titleCols.some((tc) => cell(r, tc.col));
    if (!date) {
      if (anyTitle || timeText) warnings.push(`${i + 1} 行目: 日付が読めません「${cell(r, m.date)}」`);
      skipped++;
      continue;
    }
    if (!anyTitle && !timeText) {
      skipped++;
      continue;
    }
    const place = cell(r, m.place) || undefined;
    const endRaw = cell(r, m.endDate);
    const endDate = endRaw ? parseSheetDate(endRaw, fy) : undefined;
    const slotRaw = cell(r, m.slot);
    let made = 0;
    for (const tc of titleCols) {
      const title0 = cell(r, tc.col);
      // 班ごとの列では、空の列はその班に予定なし。1 列だけなら時刻だけの行も予定にする
      if (!title0 && (wide || !timeText)) continue;
      // セルが複数行なら、1 行目を件名、残りを備考に（表や ICS で読みやすく。時刻は全文から拾う）
      const full = title0 || timeText;
      const lines = full.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const title = lines[0] ?? full;
      const rest = lines.slice(1).join(' / ') || undefined;
      let cats: string[];
      if (wide) {
        const s = tc.slot ?? headerOf(tc.col);
        cats = s === '*' || !s ? o.slots : [s];
      } else cats = slotRaw ? slotRaw.split(/[・,、/／]/).map((x) => x.trim()).filter(Boolean) : o.slots;
      const kind = inferKind(`${full} ${timeText}`, rules, fallback);
      // 時刻: 時刻の列 → 内容の中 の順。「業後」「放課後」は設定の開始時刻
      let t = parseTimeRange(timeText || full, settings);
      if (!t.start && /業後|放課後/.test(`${timeText} ${title}`)) t = { start: settings.afterSchoolStart };
      const timed = !['off', 'self', 'pause:test', 'pause:holiday', 'exam', 'holiday', 'no_class', 'class'].includes(kind);
      const base = { school: o.school, layer: o.layer, layerType: o.layerType, date, endDate: endDate && endDate > date ? endDate : undefined, kind, title, place, sourceRef: `${o.fileRef}#${i + 1}${wide ? `:${tc.col + 1}` : ''}` } as const;
      // 班の列があって複数の班なら 1 件にまとめる（表で横結合、配信は班ごと）
      const known = cats.filter((c) => o.slots.includes(c));
      const list = known.length ? known : cats;
      const noteParts = [rest, timeText && timeText !== full && !t.start ? timeText : undefined].filter(Boolean) as string[];
      events.push({ ...base, category: list[0], slots: list.length > 1 ? list : undefined, timeStart: timed ? t.start : undefined, timeEnd: timed ? t.end : undefined, note: noteParts.length ? noteParts.join(' / ') : undefined });
      made++;
    }
    if (!made) skipped++;
  }
  return { events, warnings, skipped };
}
