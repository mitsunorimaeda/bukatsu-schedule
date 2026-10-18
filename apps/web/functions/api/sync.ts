/**
 * シートの自動更新。定期実行（Cloudflare Workers の cron など）から叩く。
 *   POST /api/sync   Authorization: Bearer <SYNC_KEY>
 * つないでいる全カレンダー（layers.source.kind = 'sheet'）の CSV を取りに行き、前回と違えば版を作る。
 * カレンダーごとの設定 source.auto: apply（そのまま反映・既定）/ pending（確認待ちにする）/ off（見に行かない）。
 * 結果は layers.source に lastSync / lastHash / lastCount / lastError として残す（画面の設定に出る）。
 */
import { eventsHash, mergeSpans, normalize, parseCsv, sheetRowsToEvents } from '../../../../packages/core/src/browser';
import type { LayerType, SchoolSettings, SheetSource } from '../../../../packages/core/src/browser';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SYNC_KEY?: string;
}
interface LayerRow {
  school_id: string;
  id: string;
  name: string;
  type: LayerType;
  slots: string[];
  source: SheetSource;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'bukatsu', 'Accept-Profile': 'bukatsu' };
  if (init.headers) Object.assign(headers, init.headers as Record<string, string>);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function fetchCsv(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'bukatsu-schedule/1 (+sheet sync)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 5 * 1024 * 1024) throw new Error('5MB を超えています');
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('CSV ではなく Web ページが返りました（シートが公開されていない可能性）');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function syncOne(env: Env, l: LayerRow, settings: SchoolSettings): Promise<{ layer: string; result: string }> {
  const src = l.source;
  const now = new Date().toISOString();
  const patch = async (p: Partial<SheetSource>) => {
    const res = await sb(env, `layers?school_id=eq.${encodeURIComponent(l.school_id)}&id=eq.${encodeURIComponent(l.id)}`, { method: 'PATCH', body: JSON.stringify({ source: { ...src, ...p } }) });
    if (!res.ok) throw new Error(`記録できません: ${await res.text()}`);
  };
  try {
    const csv = await fetchCsv(src.csvUrl);
    const rows = parseCsv(csv);
    const conv = sheetRowsToEvents(rows, { school: l.school_id, layer: l.id, layerType: l.type, slots: l.slots?.length ? l.slots : ['全体'], mapping: src.mapping, settings, fileRef: 'sheet' });
    const events = mergeSpans(normalize(conv.events, settings));
    const hash = eventsHash(conv.events);
    if (hash === src.lastHash) {
      await patch({ lastSync: now, lastError: null });
      return { layer: `${l.school_id}/${l.id}`, result: 'unchanged' };
    }
    if (events.length === 0) {
      await patch({ lastSync: now, lastError: '予定が 1 件も作れませんでした（列の選び方かシートの中身を確かめてください）' });
      return { layer: `${l.school_id}/${l.id}`, result: 'empty' };
    }
    const label = `シート自動 ${new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const ver = await sb(env, 'source_versions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ school_id: l.school_id, layer_id: l.id, label, source: 'sheet-auto', status: 'pending', event_count: events.length }) });
    if (!ver.ok) throw new Error(`版を作れません: ${await ver.text()}`);
    const versionId = ((await ver.json()) as { id: string }[])[0].id;
    const rowsOut = events.map((e) => ({ version_id: versionId, school_id: l.school_id, layer_id: l.id, uid: e.uid, category: e.category, slots: e.slots?.length ? e.slots : [e.category], date: e.date, end_date: e.endDate ?? null, kind: e.kind, time_start: e.timeStart ?? null, time_end: e.timeEnd ?? null, place: e.place ?? null, title: e.title, note: e.note ?? null, source_ref: e.sourceRef ?? null, confidence: null, draft: false }));
    for (let i = 0; i < rowsOut.length; i += 500) {
      const ins = await sb(env, 'events', { method: 'POST', body: JSON.stringify(rowsOut.slice(i, i + 500)) });
      if (!ins.ok) throw new Error(`予定を保存できません: ${await ins.text()}`);
    }
    let result = 'pending';
    if ((src.auto ?? 'apply') === 'apply') {
      const ap = await sb(env, 'rpc/approve_version_system', { method: 'POST', body: JSON.stringify({ p_version: versionId }) });
      if (!ap.ok) throw new Error(`反映できません: ${await ap.text()}`);
      result = 'applied';
    }
    await patch({ lastSync: now, lastHash: hash, lastCount: events.length, lastError: null, lastChange: now });
    return { layer: `${l.school_id}/${l.id}`, result: `${result} (${events.length})` };
  } catch (e) {
    await patch({ lastSync: now, lastError: (e as Error).message }).catch(() => undefined);
    return { layer: `${l.school_id}/${l.id}`, result: `error: ${(e as Error).message}` };
  }
}

async function run(env: Env, request: Request): Promise<Response> {
  if (!env.SYNC_KEY) return json({ error: 'SYNC_KEY が設定されていません' }, 503);
  const key = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (key !== env.SYNC_KEY) return json({ error: '鍵が違います' }, 401);
  const started = Date.now();
  const lr = await sb(env, 'layers?source->>kind=eq.sheet&select=school_id,id,name,type,slots,source');
  if (!lr.ok) return json({ error: `カレンダーを読めません: ${await lr.text()}` }, 502);
  const layers = ((await lr.json()) as LayerRow[]).filter((l) => (l.source?.auto ?? 'apply') !== 'off' && l.source?.csvUrl);
  const sr = await sb(env, 'schools?select=id,settings');
  const settingsById = new Map((((await sr.json()) as { id: string; settings: SchoolSettings }[]) ?? []).map((s) => [s.id, s.settings]));
  const results: { layer: string; result: string }[] = [];
  for (const l of layers) {
    if (Date.now() - started > 25000) {
      results.push({ layer: `${l.school_id}/${l.id}`, result: 'skipped (time)' });
      continue;
    }
    results.push(await syncOne(env, l, settingsById.get(l.school_id) ?? ({} as SchoolSettings)));
  }
  return json({ checked: layers.length, results, ms: Date.now() - started });
}

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => run(env, request);
export const onRequestGet: PagesFunction<Env> = ({ request, env }) => run(env, request);
