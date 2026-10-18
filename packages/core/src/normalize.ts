import { ALLDAY_KINDS, DEFAULT_SCHOOL_SETTINGS } from './types.js';
import type { Kind, ScheduleEvent, ScheduleEventInput, SchoolSettings } from './types.js';
import { eventUid } from './uid.js';
import { isNationalHolidayEvent } from './holidays.js';

/** 種類の判定語。学校ごとの設定で上書きできる */
export interface KindRule {
  pattern: RegExp;
  kind: Kind;
}

export const DEFAULT_CLUB_KIND_RULES: KindRule[] = [
  { pattern: /テスト勉強|考査|テスト期間/, kind: 'pause:test' },
  { pattern: /\bvs\b|キックオフ|練習試合|試合/i, kind: 'match' },
  { pattern: /^off\b|^オフ\b|休み|休養/i, kind: 'off' },
  { pattern: /各自練習|自主練|各自調整/, kind: 'self' },
  { pattern: /選手権|大会|記録会|駅伝|リーグ|デカスロン|国スポ|IH|インターハイ|新人戦|ランキング|杯/, kind: 'competition' },
  { pattern: /練習|業後|\d{1,2}時|\d{1,2}:\d{2}|朝練|トレーニング|合同/, kind: 'practice' },
  { pattern: /リカバリー|ミーティング|参観|式|行事|説明会/, kind: 'event' },
];

export const DEFAULT_SCHOOL_KIND_RULES: KindRule[] = [
  // 「中間考査後～期末考査前」のように考査を時期の目印に使う文は除く
  { pattern: /考査(?![後前])/, kind: 'exam' },
  { pattern: /振替休日|の日$|天皇誕生日|元日|憲法記念日|文化の日|勤労感謝|創立記念日|県民の日|学校ホリデー|学校閉鎖|冬季休業|夏季休業|春季休業|休業/, kind: 'holiday' },
  { pattern: /授業なし|家庭学習|休校/, kind: 'no_class' },
  { pattern: /短縮|\d+分\d+限|\d+分授業/, kind: 'class' },
];

export function inferKind(text: string, rules: KindRule[], fallback: Kind = 'unknown'): Kind {
  const t = (text ?? '').trim();
  if (!t) return fallback;
  for (const r of rules) if (r.pattern.test(t)) return r.kind;
  return fallback;
}

export interface TimeRange {
  start?: string;
  end?: string;
}

function hhmm(h: string, m?: string): string {
  return `${String(Number(h)).padStart(2, '0')}:${m ?? '00'}`;
}

/**
 * 自由記述から時刻を取り出す。
 *  "9:00-13:00" / "16:30～18:30" → 両方
 *  "16:10までに練習場へ … 18:30に終わり" → 16:10 / 18:30
 *  "9時" / "13時@瑞若" / "15:15 バス出発" → 開始のみ
 *  "業後" → afterSchoolStart
 */
export function parseTimeRange(text: string, settings: SchoolSettings = DEFAULT_SCHOOL_SETTINGS): TimeRange {
  const t = (text ?? '').replace(/[：]/g, ':').replace(/[〜~～－-]/g, '-');
  const first = t.match(/(\d{1,2}):(\d{2})/);
  // 「16:10までに練習場へ … 18:30に終わり」型を最優先（途中に部分練習の範囲があっても全体の枠を取る）
  const endMark = t.match(/(\d{1,2}):(\d{2})\s*(?:に)?終わり/);
  if (first && endMark) return { start: hhmm(first[1], first[2]), end: hhmm(endMark[1], endMark[2]) };
  const range = t.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (range) return { start: hhmm(range[1], range[2]), end: hhmm(range[3], range[4]) };
  const rangeHour = t.match(/(\d{1,2})時\s*-\s*(\d{1,2})時/);
  if (rangeHour) return { start: hhmm(rangeHour[1]), end: hhmm(rangeHour[2]) };
  if (first) return { start: hhmm(first[1], first[2]), end: undefined };
  const hour = t.match(/(\d{1,2})時(半)?/);
  if (hour) return { start: hhmm(hour[1], hour[2] ? '30' : '00') };
  if (/業後|放課後/.test(t)) return { start: settings.afterSchoolStart };
  return {};
}

/** NFKC（全角英数・記号 → 半角）+ 空白の正規化。「15:15 バス出発」と「15:15バス出発」は同一視しない（空白は残す） */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function addMinutes(hhmmStr: string, minutes: number): string {
  const [h, m] = hhmmStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 場所の抽出: "業後＠瑞若" "9時　瑞若" "練習 15:15 バス出発 神領" の末尾語 */
export function parsePlace(text: string): string | undefined {
  const t = (text ?? '').trim();
  const at = t.match(/[＠@]\s*([^\s　,、]+)/);
  if (at) return at[1];
  const tail = t.match(/(?:業後|\d{1,2}時)[\s　]+([^\s　@＠\d][^\s　]*)$/);
  if (tail) return tail[1];
  return undefined;
}

/**
 * 入力イベントを正規化して uid を付ける。
 *  - 終日種類は時刻を落とす
 *  - 時刻ありで終了不明なら既定時間を足す
 *  - 同じ (layer, category, date, kind) が複数あれば seq で uid を分ける
 *  - 国民の祝日そのもの（「海の日」「祝日」だけの予定）は落とす（settings.skipNationalHolidays が false なら残す）
 */
export function normalize(inputs: ScheduleEventInput[], settings: SchoolSettings = DEFAULT_SCHOOL_SETTINGS): ScheduleEvent[] {
  const seqCount = new Map<string, number>();
  const out: ScheduleEvent[] = [];
  for (const raw of inputs) {
    const e: ScheduleEventInput = { ...raw };
    // 表記ゆれ（全角数字・全角スペース・連続空白）を吸収して、版の差分や AI 読みの比較がぶれないようにする
    e.title = normalizeText(e.title ?? '');
    if (e.place) e.place = normalizeText(e.place) || undefined;
    if (e.note) e.note = e.note.normalize('NFKC').replace(/[ \t]+/g, ' ').trim() || undefined;
    e.category = e.category?.trim() || '全体';
    if (settings.skipNationalHolidays !== false && isNationalHolidayEvent(e)) continue;
    if (ALLDAY_KINDS.has(e.kind)) {
      delete e.timeStart;
      delete e.timeEnd;
    } else if (e.timeStart && !e.timeEnd) {
      e.timeEnd = addMinutes(e.timeStart, settings.defaultDurationMin);
    }
    if (e.endDate && e.endDate <= e.date) delete e.endDate;
    const key = [e.school, e.layer, e.category, e.date, e.kind].join('|');
    const seq = seqCount.get(key) ?? 0;
    seqCount.set(key, seq + 1);
    out.push({ ...e, uid: eventUid(e, seq) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.layer.localeCompare(b.layer) || a.category.localeCompare(b.category) || a.uid.localeCompare(b.uid));
}
