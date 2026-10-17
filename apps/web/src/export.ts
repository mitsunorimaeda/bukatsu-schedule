/** 予定表の書き出し（持ち出し用）。全部ブラウザの中で作る。サーバーには何も送らない */
import { buildIcs } from '@bukatsu/core/browser';
import type { ScheduleEvent } from '@bukatsu/core/browser';
import type { Calendar, UiEvent, Workspace } from './model';

export function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stampNow = () => new Date().toISOString().slice(0, 10);
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');

/** JSON: 設定・カレンダー・班・予定（下書き含む）・公開中の内容。他の環境に移すときの元データ */
export function workspaceJson(ws: Workspace): string {
  const strip = (e: UiEvent) => ({ uid: e.uid, slots: e.slots, date: e.date, endDate: e.endDate, kind: e.kind, timeStart: e.timeStart, timeEnd: e.timeEnd, place: e.place, title: e.title, note: e.note, draft: e.draft });
  return JSON.stringify(
    {
      format: 'bukatsu-schedule/1',
      exportedAt: new Date().toISOString(),
      workspace: { id: ws.id, name: ws.name, settings: ws.settings },
      calendars: ws.calendars.map((c) => ({ id: c.id, name: c.name, type: c.type, color: c.color, slots: c.slots, publishMode: c.publishMode, source: c.source, events: c.events.map(strip), published: c.published.map(strip) })),
    },
    null,
    2,
  );
}

/** CSV: 1 行 1 予定。Excel・Google シートで開ける（BOM 付き） */
export function workspaceCsv(ws: Workspace): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['カレンダー', '班', '日付', '終了日', '種類', '開始', '終了', '内容', '場所', '備考', '下書き'];
  const rows = [head.map(q).join(',')];
  for (const c of ws.calendars) for (const e of [...c.events].sort((a, b) => a.date.localeCompare(b.date))) rows.push([c.name, e.slots.join('・'), e.date, e.endDate ?? '', e.kind, e.timeStart ?? '', e.timeEnd ?? '', e.title, e.place ?? '', e.note ?? '', e.draft ? '下書き' : ''].map(q).join(','));
  return '﻿' + rows.join('\r\n');
}

function toCore(ws: Workspace, c: Calendar, e: UiEvent, prefix: boolean): ScheduleEvent {
  return { uid: e.uid, school: ws.id, layer: c.id, layerType: c.type, category: e.slots[0], slots: e.slots, date: e.date, endDate: e.endDate, kind: e.kind, timeStart: e.timeStart, timeEnd: e.timeEnd, place: e.place, title: prefix ? `[${c.name}] ${e.title}` : e.title, note: e.note };
}

/** ICS ファイル: 公開中の予定を全部 1 ファイルに。Google カレンダー等に「ファイルから取り込み」できる */
export function workspaceIcs(ws: Workspace): string {
  const events = ws.calendars.flatMap((c) => c.published.map((e) => toCore(ws, c, e, ws.calendars.length > 1)));
  return buildIcs(events, { calendarName: ws.name });
}

export function exportFileName(ws: Workspace, ext: string): string {
  return `${safe(ws.name)}_${stampNow()}.${ext}`;
}
