import { ALLDAY_KINDS, KIND_LABEL, TRANSPARENT_KINDS } from './types.js';
import type { ScheduleEvent } from './types.js';
import { addDays } from './merge.js';

export interface IcsOptions {
  calendarName: string;
  /** 省略時は全イベント */
  filter?: (e: ScheduleEvent) => boolean;
  /** 件名の先頭に [カテゴリ] を付けるか（部全体フィードで使う） */
  prefixCategory?: boolean;
  /** 版ラベル（X-BUKATSU-VERSION） */
  version?: string;
  /** SEQUENCE の元。uid → 更新回数 */
  sequences?: Map<string, number>;
  /** DTSTAMP を固定したいとき（テスト用） */
  now?: Date;
}

const PRODID = '-//ARCA//bukatsu-schedule 0.1//JA';

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 の 75 オクテット折り返し（UTF-8 のバイト境界を壊さない） */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let limit = 75;
  while (bytes.length > limit) {
    let cut = limit;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
    parts.push(dec.decode(bytes.slice(0, cut)));
    bytes = bytes.slice(cut);
    limit = 74; // 継続行は先頭スペース分 1 バイト短い
  }
  parts.push(dec.decode(bytes));
  return parts.join('\r\n ');
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildIcs(events: ScheduleEvent[], opt: IcsOptions): string {
  const now = stamp(opt.now ?? new Date());
  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opt.calendarName)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const list = opt.filter ? events.filter(opt.filter) : events;
  for (const e of list) {
    const label = KIND_LABEL[e.kind];
    const allDay = ALLDAY_KINDS.has(e.kind) || !e.timeStart;
    const d = e.date.replace(/-/g, '');
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`, `SEQUENCE:${opt.sequences?.get(e.uid) ?? 0}`);
    if (allDay) {
      L.push(`DTSTART;VALUE=DATE:${d}`);
      L.push(`DTEND;VALUE=DATE:${addDays(e.endDate ?? e.date, 1).replace(/-/g, '')}`);
      if (TRANSPARENT_KINDS.has(e.kind)) L.push('TRANSP:TRANSPARENT');
    } else {
      L.push(`DTSTART;TZID=Asia/Tokyo:${d}T${e.timeStart!.replace(':', '')}00`);
      L.push(`DTEND;TZID=Asia/Tokyo:${d}T${(e.timeEnd ?? e.timeStart!).replace(':', '')}00`);
    }
    let summary = e.title || label;
    if (opt.prefixCategory && e.category !== '全体') summary = `[${e.category}] ${summary}`;
    L.push(foldLine(`SUMMARY:${escapeText(summary)}`));
    if (e.place) L.push(foldLine(`LOCATION:${escapeText(e.place)}`));
    if (e.note) L.push(foldLine(`DESCRIPTION:${escapeText(e.note)}`));
    L.push(foldLine(`CATEGORIES:${escapeText(e.category)},${escapeText(label)}`));
    L.push(`X-BUKATSU-LAYER:${e.layer}`);
    L.push(`X-BUKATSU-KIND:${e.kind}`);
    L.push(foldLine(`X-BUKATSU-CATEGORY:${escapeText(e.category)}`));
    if (opt.version) L.push(foldLine(`X-BUKATSU-VERSION:${escapeText(opt.version)}`));
    if (e.sourceRef) L.push(foldLine(`X-BUKATSU-SOURCE:${escapeText(e.sourceRef)}`));
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
