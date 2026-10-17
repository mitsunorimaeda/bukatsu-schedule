import { SPAN_KINDS } from './types.js';
import type { ScheduleEvent } from './types.js';
import { eventUid } from './uid.js';

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 連続する同じ (layer, category, kind, title) の終日イベントを 1 件の期間に畳む。
 * 休止期間・考査を「11/30〜12/3」のように 1 件で扱うため。
 * uid は先頭日のものを使う。note は重複を除いて連結する。
 */
export function mergeSpans(events: ScheduleEvent[]): ScheduleEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.layer.localeCompare(b.layer) || a.category.localeCompare(b.category) || a.kind.localeCompare(b.kind) || a.date.localeCompare(b.date),
  );
  const out: ScheduleEvent[] = [];
  for (const e of sorted) {
    const p = out[out.length - 1];
    const canMerge =
      p &&
      SPAN_KINDS.has(e.kind) &&
      p.kind === e.kind &&
      p.layer === e.layer &&
      p.category === e.category &&
      p.title === e.title &&
      !e.timeStart &&
      !p.timeStart &&
      addDays(p.endDate ?? p.date, 1) === e.date;
    if (canMerge) {
      p.endDate = e.endDate ?? e.date;
      if (e.note && !(p.note ?? '').includes(e.note)) p.note = [p.note, e.note].filter(Boolean).join('\n');
    } else {
      out.push({ ...e });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.layer.localeCompare(b.layer) || a.category.localeCompare(b.category));
}

/**
 * 期間イベントを日ごとに展開する（月間表の描画・版の差分用）。
 * 各日の uid はその日単独で正規化したときと同じ値にする（畳む前の uid に戻る）。
 * 元の期間の先頭日 uid は spanUid に残す。
 */
export function expandSpans(events: ScheduleEvent[]): (ScheduleEvent & { spanUid?: string })[] {
  const out: (ScheduleEvent & { spanUid?: string })[] = [];
  for (const e of events) {
    if (!e.endDate) {
      out.push(e);
      continue;
    }
    for (let d = e.date; d <= e.endDate; d = addDays(d, 1)) {
      out.push({ ...e, date: d, endDate: undefined, uid: eventUid({ ...e, date: d }), spanUid: e.uid });
    }
  }
  return out;
}
