/**
 * 取り込み結果を Supabase に保存する。
 *   npm run load -- --school schools/meiden.yaml [--target local|cloud] [--layer id] [--ai mock|live|record] [--online] [--approve]
 * 環境変数（.env、コミットしない）: ローカル SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY、クラウド SUPABASE_CLOUD_URL / SUPABASE_CLOUD_SERVICE_ROLE_KEY
 *  - 決定的な取り込み（xlsx/csv）は approved、AI 読み（pdf）は pending で入る（--approve で全部 approved）
 *  - 直前の版との差分を event_changes に保存する
 */
import { createClient } from '@supabase/supabase-js';
import { AiReader, diffVersions } from '@bukatsu/core';
import type { ScheduleEvent } from '@bukatsu/core';
import { importLayer, loadSchoolConfig } from './index.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function toRow(e: ScheduleEvent, versionId: string) {
  return {
    version_id: versionId,
    school_id: e.school,
    layer_id: e.layer,
    uid: e.uid,
    category: e.category,
    slots: e.slots?.length ? e.slots : [e.category],
    date: e.date,
    end_date: e.endDate ?? null,
    kind: e.kind,
    time_start: e.timeStart ?? null,
    time_end: e.timeEnd ?? null,
    place: e.place ?? null,
    title: e.title,
    note: e.note ?? null,
    source_ref: e.sourceRef ?? null,
    confidence: e.confidence ?? null,
  };
}

function fromRow(r: Record<string, unknown>): ScheduleEvent {
  const t = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : undefined);
  return {
    uid: r.uid as string,
    school: r.school_id as string,
    layer: r.layer_id as string,
    layerType: 'club',
    category: r.category as string,
    date: r.date as string,
    endDate: (r.end_date as string | null) ?? undefined,
    kind: r.kind as ScheduleEvent['kind'],
    timeStart: t(r.time_start),
    timeEnd: t(r.time_end),
    place: (r.place as string | null) ?? undefined,
    title: r.title as string,
    note: (r.note as string | null) ?? undefined,
  };
}

async function main() {
  // --target cloud で本番の Supabase（SUPABASE_CLOUD_*）、既定はローカル（SUPABASE_*）
  const target = arg('target', 'local');
  const url = target === 'cloud' ? process.env.SUPABASE_CLOUD_URL : process.env.SUPABASE_URL;
  const key = target === 'cloud' ? process.env.SUPABASE_CLOUD_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(target === 'cloud' ? '.env に SUPABASE_CLOUD_URL と SUPABASE_CLOUD_SERVICE_ROLE_KEY が必要です' : '.env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
  }
  console.log(`# target=${target} ${url}`);
  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'bukatsu' } });
  const cfg = loadSchoolConfig(arg('school', 'schools/meiden.yaml')!);
  const only = arg('layer');
  const reader = new AiReader({ mode: (arg('ai') as 'mock' | 'live' | 'record' | undefined) ?? undefined });

  const { error: se } = await sb.from('schools').upsert({ id: cfg.id, name: cfg.name, settings: cfg.settings });
  if (se) throw se;
  const { error: le } = await sb.from('layers').upsert(
    cfg.layers.map((l, i) => ({
      school_id: cfg.id,
      id: l.id,
      type: l.type,
      name: l.name,
      color: l.color ?? null,
      sort: i,
      slots: (l as { slots?: string[] }).slots ?? ['全体'],
      publish_mode: (l as { publishMode?: string }).publishMode ?? 'auto',
      source: { kind: l.source.kind, ...('prompt' in l.source ? { prompt: l.source.prompt } : {}) },
    })),
  );
  if (le) throw le;

  for (const layer of cfg.layers) {
    if (only && layer.id !== only) continue;
    const versions = await importLayer(cfg, layer, { reader, online: flag('online') });
    if (!versions.length) continue; // 手入力の層は画面から書く
    for (const v of versions) {
      const deterministic = layer.source.kind !== 'pdf';
      const status = deterministic || flag('approve') ? 'approved' : 'pending';
      // 直前の版（差分の基準）
      const { data: prevV } = await sb
        .from('source_versions')
        .select('id,label')
        .eq('school_id', cfg.id)
        .eq('layer_id', layer.id)
        .order('imported_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: ver, error: ve } = await sb
        .from('source_versions')
        .insert({
          school_id: cfg.id,
          layer_id: layer.id,
          label: v.label,
          source: v.source,
          ai_model: v.aiModel ?? null,
          ai_mode: v.aiMode ?? null,
          status,
          event_count: v.events.length,
          approved_at: status === 'approved' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();
      if (ve) throw ve;
      const rows = v.events.map((e) => toRow(e, ver.id));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from('events').insert(rows.slice(i, i + 500));
        if (error) throw error;
      }
      let changeCount = 0;
      if (prevV) {
        const { data: prevRows, error: pe } = await sb.from('events').select('*').eq('version_id', prevV.id);
        if (pe) throw pe;
        const changes = diffVersions((prevRows ?? []).map(fromRow), v.events);
        changeCount = changes.length;
        if (changes.length) {
          const { error } = await sb.from('event_changes').insert(
            changes.map((c) => ({
              school_id: cfg.id,
              layer_id: layer.id,
              from_version: prevV.id,
              to_version: ver.id,
              uid: c.uid,
              change: c.change,
              fields: c.fields,
              before: c.before ?? null,
              after: c.after ?? null,
            })),
          );
          if (error) throw error;
        }
      }
      console.log(`- ${layer.id} [${v.label}] ${v.events.length} 件 → ${status}${prevV ? `  前版 [${prevV.label}] との差分 ${changeCount} 件` : ''}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
