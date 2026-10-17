/**
 * フェンシング部型: 公開 Google シートの CSV。1 日 1 行、基本スケジュール（セル内改行）+ イベント列。
 * ignoreColumns（別スケジュール・ゲスト = 選手名）は読まない。AI は使わない。
 */
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { DEFAULT_CLUB_KIND_RULES, inferKind, mergeSpans, normalize, parseTimeRange } from '@bukatsu/core';
import type { ScheduleEventInput } from '@bukatsu/core';
import type { CsvSourceConfig, LayerConfig, SchoolConfig } from './config.js';
import { inRange, resolvePath } from './config.js';
import type { ImportedVersion } from './types.js';

function toIso(s: string): string | undefined {
  const m = s.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
}

export async function fetchCsv(src: CsvSourceConfig, cfg: SchoolConfig, online: boolean): Promise<{ text: string; from: string }> {
  if (online && src.url) {
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`CSV 取得失敗 ${res.status}: ${src.url}`);
    return { text: await res.text(), from: src.url };
  }
  if (!src.path) throw new Error('source.path も url もありません');
  return { text: readFileSync(resolvePath(cfg, src.path), 'utf8'), from: src.path };
}

export function csvRowsToEvents(
  rows: Record<string, string>[],
  ctx: { school: string; layer: string; src: CsvSourceConfig; afterSchoolStart: string },
): ScheduleEventInput[] {
  const { columns } = ctx.src;
  const base = { school: ctx.school, layer: ctx.layer, layerType: 'club' as const, category: '全体' };
  const out: ScheduleEventInput[] = [];
  rows.forEach((r, i) => {
    const date = toIso(r[columns.date] ?? '');
    if (!date || !inRange(date, ctx.src.dateRange)) return;
    const ref = `csv:row${i + 2}`;
    const sched = (r[columns.schedule] ?? '').trim();
    const events = columns.events ? (r[columns.events] ?? '').trim() : '';
    const classes = columns.classes ? (r[columns.classes] ?? '').trim() : '';

    if (/^off$/i.test(sched)) {
      out.push({ ...base, date, kind: 'off', title: 'OFF', sourceRef: ref });
    } else if (sched) {
      const t = parseTimeRange(sched, { afterSchoolStart: ctx.afterSchoolStart, defaultDurationMin: 120, fiscalYearStartMonth: 4 });
      if (t.start) {
        out.push({ ...base, date, kind: 'practice', title: '練習', timeStart: t.start, timeEnd: t.end, note: sched, sourceRef: ref });
      } else {
        const kind = inferKind(sched, DEFAULT_CLUB_KIND_RULES, 'event');
        // 「学年別大会」のように時刻なしの大会名で、イベント列にも同じ大会がある日は二重にしない
        if (!(kind === 'competition' && events)) out.push({ ...base, date, kind, title: sched.split('\n')[0], note: sched, sourceRef: ref });
      }
    }
    if (events) {
      for (const line of events.split('\n').map((s) => s.trim()).filter(Boolean)) {
        out.push({ ...base, date, kind: 'competition', title: line, sourceRef: ref });
      }
    }
    if (/考査/.test(classes)) {
      out.push({ ...base, date, kind: 'pause:test', title: 'テスト期間', note: classes, sourceRef: ref });
    }
  });
  return out;
}

export async function importFencingCsv(cfg: SchoolConfig, layer: LayerConfig, opt: { online: boolean }): Promise<ImportedVersion> {
  const src = layer.source as CsvSourceConfig;
  const { text, from } = await fetchCsv(src, cfg, opt.online);
  const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  const header = Object.keys(rows[0] ?? {});
  const warnings: string[] = [];
  for (const c of Object.values(src.columns)) if (!header.includes(c)) warnings.push(`列が見つかりません: ${c}`);
  // 読まない列を物理的に落とす（以後のコードが触れないように）
  const ignore = new Set(src.ignoreColumns ?? []);
  const safeRows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !ignore.has(k))));
  const inputs = csvRowsToEvents(safeRows, { school: cfg.id, layer: layer.id, src, afterSchoolStart: cfg.settings.afterSchoolStart });
  const events = mergeSpans(normalize(inputs, cfg.settings));
  return {
    layerId: layer.id,
    label: `${opt.online ? 'シート' : 'CSV'} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    events,
    source: `csv:${from}`,
    warnings,
  };
}
