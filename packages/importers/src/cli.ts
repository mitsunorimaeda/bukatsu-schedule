/**
 * 使い方:
 *   npm run import -- --school schools/meiden.yaml [--layer club:soccer] [--out out] [--online] [--ai mock|live|record]
 * 出力: out/<school>/<layer>/<版>/events.json, layer.ics, cat/<カテゴリ>.ics, 版が複数なら changes.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiReader, KIND_LABEL, buildIcs, diffVersions, renderChangesMarkdown } from '@bukatsu/core';
import type { ScheduleEvent } from '@bukatsu/core';
import { importLayer, loadSchoolConfig } from './index.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_');
}

function summary(events: ScheduleEvent[]): string {
  const by = new Map<string, number>();
  for (const e of events) by.set(KIND_LABEL[e.kind], (by.get(KIND_LABEL[e.kind]) ?? 0) + 1);
  return [...by].map(([k, n]) => `${k} ${n}`).join(', ');
}

async function main() {
  const cfgPath = arg('school', 'schools/meiden.yaml')!;
  const cfg = loadSchoolConfig(cfgPath);
  const only = arg('layer');
  const outRoot = arg('out', 'out')!;
  const reader = new AiReader({ mode: (arg('ai') as 'mock' | 'live' | 'record' | undefined) ?? undefined });
  const online = flag('online');
  console.log(`# ${cfg.name} (${cfg.id})  AI=${reader.mode}  online=${online}`);

  // Web 画面（静的モード）用の 1 ファイル: out/<school>/bundle.json
  const bundle: {
    school: { id: string; name: string; settings: typeof cfg.settings };
    generatedAt: string;
    layers: { id: string; type: string; name: string; color?: string; versions: { label: string; source: string; aiMode?: string; events: ScheduleEvent[]; changes: ReturnType<typeof diffVersions> }[] }[];
  } = { school: { id: cfg.id, name: cfg.name, settings: cfg.settings }, generatedAt: new Date().toISOString(), layers: [] };

  for (const layer of cfg.layers) {
    if (only && layer.id !== only) continue;
    const bundleLayer: (typeof bundle.layers)[number] = { id: layer.id, type: layer.type, name: layer.name, color: layer.color, versions: [] };
    bundle.layers.push(bundleLayer);
    let versions;
    try {
      versions = await importLayer(cfg, layer, { reader, online });
    } catch (e) {
      console.log(`- ${layer.id} (${layer.name}): 失敗: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!versions.length) {
      console.log(`- ${layer.id} (${layer.name}): 手入力の層（取り込みなし）`);
      continue;
    }
    let prev: ScheduleEvent[] | undefined;
    for (const v of versions) {
      const dir = join(outRoot, cfg.id, safe(layer.id), safe(v.label));
      mkdirSync(join(dir, 'cat'), { recursive: true });
      writeFileSync(join(dir, 'events.json'), JSON.stringify(v, null, 2) + '\n');
      writeFileSync(join(dir, 'layer.ics'), buildIcs(v.events, { calendarName: `${cfg.name} ${layer.name}`, version: v.label, prefixCategory: true }));
      const cats = [...new Set(v.events.map((e) => e.category))];
      for (const c of cats) {
        if (c === '全体') continue;
        writeFileSync(
          join(dir, 'cat', `${safe(c)}.ics`),
          buildIcs(v.events, { calendarName: `${cfg.name} ${layer.name} ${c}`, version: v.label, filter: (e) => e.category === c || e.category === '全体' }),
        );
      }
      let changesNote = '';
      const changes = prev ? diffVersions(prev, v.events) : [];
      if (prev) {
        writeFileSync(join(dir, 'changes.md'), renderChangesMarkdown(changes, `${layer.name} ${v.label} の変更`));
        changesNote = `  変更 ${changes.length} 件 → changes.md`;
      }
      bundleLayer.versions.push({ label: v.label, source: v.source, aiMode: v.aiMode, events: v.events, changes });
      console.log(`- ${layer.id} [${v.label}] ${v.events.length} 件 (${summary(v.events)}) カテゴリ: ${cats.join('/')}${changesNote}`);
      for (const w of v.warnings) console.log(`    ! ${w}`);
      prev = v.events;
    }
  }
  if (!only) {
    mkdirSync(join(outRoot, cfg.id), { recursive: true });
    writeFileSync(join(outRoot, cfg.id, 'bundle.json'), JSON.stringify(bundle) + '\n');
    console.log(`→ ${join(outRoot, cfg.id, 'bundle.json')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
