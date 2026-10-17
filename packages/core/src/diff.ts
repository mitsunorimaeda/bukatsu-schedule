import type { EventChange, ScheduleEvent } from './types.js';
import { expandSpans } from './merge.js';

const COMPARE_FIELDS: (keyof ScheduleEvent)[] = ['title', 'timeStart', 'timeEnd', 'place', 'note', 'kind', 'category'];

/**
 * 2 つの版の差分。
 *  - 期間イベントは日ごとに展開してから比較する（畳み方の違いで差分が出ないように）
 *  - uid が同じ → 項目の変更
 *  - 同じ (層, カテゴリ, 日) で種類が変わった（練習 → OFF など）→ 取消 + 追加ではなく 1 件の「変更」にまとめる
 */
export function diffVersions(before: ScheduleEvent[], after: ScheduleEvent[]): EventChange[] {
  const b = new Map(expandSpans(before).map((e) => [e.uid, e]));
  const a = new Map(expandSpans(after).map((e) => [e.uid, e]));
  const out: EventChange[] = [];
  const added: ScheduleEvent[] = [];
  const removed: ScheduleEvent[] = [];
  for (const [uid, ev] of a) {
    const prev = b.get(uid);
    if (!prev) {
      added.push(ev);
      continue;
    }
    const fields = COMPARE_FIELDS.filter((f) => (prev[f] ?? '') !== (ev[f] ?? ''));
    if (fields.length) out.push({ uid, change: 'changed', before: prev, after: ev, fields });
  }
  for (const [uid, ev] of b) if (!a.has(uid)) removed.push(ev);

  // 同じ (層, カテゴリ, 日) の取消と追加を「変更」に束ねる
  const slot = (e: ScheduleEvent) => `${e.layer}|${e.category}|${e.date}`;
  const removedBySlot = new Map<string, ScheduleEvent[]>();
  for (const r of removed) (removedBySlot.get(slot(r)) ?? removedBySlot.set(slot(r), []).get(slot(r))!).push(r);
  for (const ev of added) {
    const cands = removedBySlot.get(slot(ev));
    const prev = cands?.shift();
    if (prev) {
      const fields = COMPARE_FIELDS.filter((f) => (prev[f] ?? '') !== (ev[f] ?? ''));
      out.push({ uid: ev.uid, change: 'changed', before: prev, after: ev, fields });
    } else {
      out.push({ uid: ev.uid, change: 'added', after: ev, fields: [] });
    }
  }
  for (const list of removedBySlot.values()) for (const r of list) out.push({ uid: r.uid, change: 'removed', before: r, fields: [] });

  return out.sort((x, y) => {
    const ex = (x.after ?? x.before)!;
    const ey = (y.after ?? y.before)!;
    return ex.date.localeCompare(ey.date) || ex.category.localeCompare(ey.category) || x.uid.localeCompare(y.uid);
  });
}

function fmt(e: ScheduleEvent | undefined): string {
  if (!e) return '（空欄）';
  const t = e.timeStart ? ` ${e.timeStart}${e.timeEnd ? `〜${e.timeEnd}` : ''}` : '';
  const p = e.place ? `｜${e.place}` : '';
  return `${e.title}${t}${p}`;
}

function md(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 変更一覧の Markdown（通知文の下書き。人名は元から含まれない前提） */
export function renderChangesMarkdown(changes: EventChange[], heading = '予定が更新されました'): string {
  if (!changes.length) return `${heading}: 変更はありません。\n`;
  const byCat = new Map<string, string[]>();
  for (const c of changes) {
    const e = (c.after ?? c.before)!;
    let line: string;
    if (c.change === 'added') line = `${md(e.date)} 追加: ${fmt(c.after)}`;
    else if (c.change === 'removed') line = `${md(e.date)} 取消: ${fmt(c.before)}`;
    else line = `${md(e.date)} ${fmt(c.before)} → ${fmt(c.after)}`;
    (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(line);
  }
  const parts = [`## ${heading}`, ''];
  for (const [cat, lines] of byCat) {
    parts.push(`【${cat}】`);
    for (const l of lines) parts.push(`- ${l}`);
    parts.push('');
  }
  return parts.join('\n').trimEnd() + '\n';
}
