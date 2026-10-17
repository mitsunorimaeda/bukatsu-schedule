import type { ScheduleEventInput } from './types.js';

/** FNV-1a 64bit（純 TS。Node でもブラウザでも同じ値） */
export function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * 安定 ID。版をまたいで同じイベントを同じ UID にするため、
 * 内容（title/時刻/場所）は含めず (school, layer, category, date, kind) だけから作る。
 * 同じ日に同じ種類が 2 件以上あるとき（例: 学校行事が 2 つ）は seq で区別する。
 */
export function eventUid(e: Pick<ScheduleEventInput, 'school' | 'layer' | 'category' | 'date' | 'kind'>, seq = 0): string {
  const key = [e.school, e.layer, e.category, e.date, e.kind, seq].join('|');
  return `${fnv1a64(key)}@bukatsu-schedule.arca.fit`;
}
