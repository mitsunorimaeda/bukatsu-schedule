/**
 * 陸上部型: 1 日 1 行のシート（日付 / 曜日 / 集合時間 / イベント）。
 * 指定した列しか読まない（E 列以降の班別メニューには選手名が入っている）。
 * AI は使わない。
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  DEFAULT_CLUB_KIND_RULES,
  inferKind,
  mergeSpans,
  normalize,
  parsePlace,
  parseTimeRange,
} from '@bukatsu/core';
import type { Kind, ScheduleEventInput } from '@bukatsu/core';
import type { LayerConfig, SchoolConfig, XlsxSourceConfig } from './config.js';
import { inRange, resolvePath } from './config.js';
import type { ImportedVersion } from './types.js';

const HOLIDAY = /の日$|振替休日|元日|天皇誕生日|憲法記念日|学校ホリデー|創立記念日/;

function isoDate(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // xlsx は日付をローカル時刻の Date にする。UTC に寄せずに年月日を取る
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) {
    const [y, m, d] = v.split(/[-/T ]/).map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return undefined;
}

export interface DayRow {
  date: string;
  time: string;
  event: string;
  rowRef: string;
}

/** シートから (日付, 集合時間, イベント) の行だけを取り出す */
export function readDayRows(file: string, src: XlsxSourceConfig): DayRow[] {
  // ESM では XLSX.readFile が fs を持たないので、バイト列を渡す
  const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[src.sheet];
  if (!ws) throw new Error(`シートがありません: ${src.sheet}（${Object.keys(wb.Sheets).join(', ')}）`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 'A', raw: true, defval: '' });
  const out: DayRow[] = [];
  rows.forEach((r, i) => {
    const date = isoDate(r[src.columns.date]);
    if (!date) return;
    out.push({
      date,
      time: String(r[src.columns.time] ?? '').trim(),
      event: String(r[src.columns.event] ?? '').trim(),
      rowRef: `${src.sheet}!${src.columns.date}${i + 1}`,
    });
  });
  return out;
}

/** 1 行 → 0〜2 件のイベント（時間欄由来 + イベント欄由来） */
export function rowToEvents(
  row: DayRow,
  ctx: { school: string; layer: string; src: XlsxSourceConfig; lastFilled: string; afterSchoolStart: string },
): ScheduleEventInput[] {
  const base = { school: ctx.school, layer: ctx.layer, layerType: 'club' as const, category: '全体', sourceRef: `xlsx:${row.rowRef}` };
  const out: ScheduleEventInput[] = [];
  const { time, event } = row;

  // イベント欄
  let eventKind: Kind | undefined;
  if (event) {
    eventKind = inferKind(event, DEFAULT_CLUB_KIND_RULES, 'event');
    if (eventKind === 'event' && HOLIDAY.test(event)) eventKind = 'off';
    if (eventKind === 'pause:test') out.push({ ...base, date: row.date, kind: 'pause:test', title: 'テスト期間', note: event });
    else out.push({ ...base, date: row.date, kind: eventKind, title: event });
  }

  // 集合時間欄
  if (time) {
    if (/各自/.test(time)) {
      out.push({ ...base, date: row.date, kind: 'self', title: '各自練習', note: time });
    } else if (/集合無し|集合なし/.test(time)) {
      out.push({ ...base, date: row.date, kind: 'off', title: '集合なし', note: time });
    } else {
      const token = Object.keys(ctx.src.timeDefaults ?? {}).find((k) => time.startsWith(k));
      const def = token ? ctx.src.timeDefaults![token] : undefined;
      const parsed = parseTimeRange(time, { afterSchoolStart: ctx.afterSchoolStart, defaultDurationMin: 120, fiscalYearStartMonth: 4 });
      const start = def?.start ?? parsed.start;
      const label = token ?? time.split(/[\s　@＠]/)[0];
      if (start) {
        out.push({
          ...base,
          date: row.date,
          kind: 'practice',
          title: `練習（${label}）`,
          timeStart: start,
          timeEnd: def?.end ?? parsed.end,
          place: parsePlace(time),
          note: time !== label ? time : undefined,
        });
      } else if (eventKind === undefined) {
        // "全員集合" "UP時間に集合" など時刻が無い → 行事扱いで残す
        out.push({ ...base, date: row.date, kind: 'event', title: time });
      } else {
        // 大会日の集合指示はイベントの note に寄せる
        const ev = out[0];
        ev.note = [ev.note, time].filter(Boolean).join('\n');
      }
    }
  } else if (!event && row.date <= ctx.lastFilled) {
    // 記入済み範囲の空欄 = 休み。未記入範囲（将来）は何も出さない
    out.push({ ...base, date: row.date, kind: 'off', title: '休み' });
  }
  return out;
}

/** 集合時間の空欄が gap 日以上続く最初の run の直前の日付。全部埋まっていれば最終日 */
export function filledHorizon(rows: DayRow[], gap = 10): string {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time) run = 0;
    else if (++run >= gap) return sorted[i - gap].date;
  }
  return sorted.at(-1)?.date ?? '0000-00-00';
}

export async function importTrackXlsx(cfg: SchoolConfig, layer: LayerConfig): Promise<ImportedVersion> {
  const src = layer.source as XlsxSourceConfig;
  const file = resolvePath(cfg, src.path);
  const rows = readDayRows(file, src).filter((r) => inRange(r.date, src.dateRange));
  const allRows = readDayRows(file, src);
  // 記入済みの範囲 = 「集合時間」の空欄が 10 日以上続く最初の地点まで。
  // （イベント欄は年度分が先に埋まり、集合時間も遠い先に点在しうるので「最後に書かれた日」では判定できない）
  const lastFilled = filledHorizon(allRows);
  const inputs = rows.flatMap((r) =>
    rowToEvents(r, { school: cfg.id, layer: layer.id, src, lastFilled, afterSchoolStart: cfg.settings.afterSchoolStart }),
  );
  const events = mergeSpans(normalize(inputs, cfg.settings));
  return {
    layerId: layer.id,
    label: src.versionLabel ?? `${src.sheet} ${new Date().toISOString().slice(0, 10)}`,
    events,
    source: `xlsx:${src.path}!${src.sheet}[${Object.values(src.columns).join('')}]`,
    warnings: [],
  };
}
