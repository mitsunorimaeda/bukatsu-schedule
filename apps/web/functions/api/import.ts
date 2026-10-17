/**
 * 取り込み（Cloudflare Pages Functions）
 *   POST /api/import  multipart/form-data: file, schoolId, calendarId, label?, kind (club-table | school-calendar), variables? (JSON)
 *   Authorization: Bearer <ログイン中のユーザーの JWT>
 * 流れ: 権限確認（ユーザーの JWT で can_edit）→ Claude で読み取り（構造化出力）→ 「確認待ち」の版として保存（service role）
 * Claude の鍵と service role はここ（サーバー側）にだけ置く。
 */
import { CLUB_TABLE_PROMPT, SCHOOL_CALENDAR_PROMPT, clubTableToEvents, mergeSpans, normalize, schoolItemsToEvents, strictSchema } from '../../../../packages/core/src/browser';
import type { ClubTableResult, Prompt, ScheduleEvent, SchoolCalendarResult } from '../../../../packages/core/src/browser';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function sb(env: Env, path: string, init: RequestInit & { token?: string; profile?: boolean } = {}) {
  const headers: Record<string, string> = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${init.token ?? env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'bukatsu', 'Accept-Profile': 'bukatsu' };
  if (init.headers) Object.assign(headers, init.headers as Record<string, string>);
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

function base64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readWithClaude<T>(env: Env, prompt: Prompt<T>, file: File, variables: Record<string, string>): Promise<{ json: T; model: string; usage: { input: number; output: number } }> {
  const bytes = await file.arrayBuffer();
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const mediaType = isPdf ? 'application/pdf' : file.type || 'image/jpeg';
  const block = isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64(bytes) } } : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64(bytes) } };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: prompt.model,
      max_tokens: prompt.maxTokens ?? 32000,
      system: prompt.system,
      output_config: { format: { type: 'json_schema', schema: strictSchema(prompt.schema) } },
      messages: [{ role: 'user', content: [block, { type: 'text', text: prompt.render(variables) }] }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = (await res.json()) as { model: string; stop_reason: string; content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
  if (msg.stop_reason === 'refusal') throw new Error('モデルが読み取りを拒否しました');
  if (msg.stop_reason === 'max_tokens') throw new Error('出力が長すぎました。ページを分けてください');
  const text = msg.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('構造化出力が返りませんでした');
  return { json: JSON.parse(text) as T, model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
}

/** 画面が「このアプリに読ませる」を出してよいか（鍵が置かれているか）を知るため */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => json({ aiConfigured: !!env.ANTHROPIC_API_KEY });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'このサーバーには AI の鍵が置かれていません。「自分の AI に読ませて貼り付ける」を使ってください' }, 503);
    const auth = request.headers.get('Authorization') ?? '';
    const userJwt = auth.replace(/^Bearer\s+/i, '');
    if (!userJwt) return json({ error: 'ログインが必要です' }, 401);
    const form = await request.formData();
    const file = form.get('file');
    const schoolId = String(form.get('schoolId') ?? '');
    const calendarId = String(form.get('calendarId') ?? '');
    const kind = String(form.get('kind') ?? 'club-table');
    const label = String(form.get('label') ?? '') || (file instanceof File ? file.name : '取り込み');
    const variables = JSON.parse(String(form.get('variables') ?? '{}')) as Record<string, string>;
    if (!(file instanceof File) || !schoolId || !calendarId) return json({ error: 'file, schoolId, calendarId が必要です' }, 400);
    if (file.size > 20 * 1024 * 1024) return json({ error: 'ファイルは 20MB までです' }, 413);

    // 権限: そのカレンダーを編集できるか（ユーザーの JWT で判定）
    const can = await sb(env, 'rpc/can_edit', { method: 'POST', token: userJwt, body: JSON.stringify({ sid: schoolId, lid: calendarId, cat: '*' }) });
    if (!can.ok || (await can.json()) !== true) return json({ error: 'このカレンダーを編集する権限がありません' }, 403);

    // カレンダーの設定（班の一覧・学校設定）
    const [layerRes, schoolRes] = await Promise.all([sb(env, `layers?school_id=eq.${encodeURIComponent(schoolId)}&id=eq.${encodeURIComponent(calendarId)}&select=*`), sb(env, `schools?id=eq.${encodeURIComponent(schoolId)}&select=settings`)]);
    const layer = ((await layerRes.json()) as { slots: string[]; name: string; source: Record<string, unknown> | null }[])[0];
    const school = ((await schoolRes.json()) as { settings: Record<string, unknown> }[])[0];
    if (!layer) return json({ error: 'カレンダーが見つかりません' }, 404);

    // 読み取り
    let events: ScheduleEvent[];
    let model: string;
    let usage: { input: number; output: number };
    const fileRef = `upload:${file.name}`;
    if (kind === 'school-calendar') {
      const r = await readWithClaude<SchoolCalendarResult>(env, SCHOOL_CALENDAR_PROMPT, file, variables);
      const conv = schoolItemsToEvents(r.json, { school: schoolId, layer: calendarId, fileRef, prefixCategories: (layer.source?.prefixCategories as Record<string, string> | undefined) ?? { '南:': '南校舎', '南：': '南校舎' } });
      events = mergeSpans(normalize(conv.events, school?.settings as never));
      model = r.model;
      usage = r.usage;
    } else {
      const vars = { clubName: layer.name, categories: layer.slots.join(', '), ...variables };
      const r = await readWithClaude<ClubTableResult>(env, CLUB_TABLE_PROMPT, file, vars);
      const conv = clubTableToEvents(r.json, { school: schoolId, layer: calendarId, fileRef, settings: school?.settings as never, categoryAliases: layer.source?.categoryAliases as Record<string, string[]> | undefined });
      events = mergeSpans(normalize(conv, school?.settings as never));
      model = r.model;
      usage = r.usage;
    }

    // 確認待ちの版として保存
    const ver = await sb(env, 'source_versions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ school_id: schoolId, layer_id: calendarId, label, source: fileRef, ai_model: model, ai_mode: 'live', status: 'pending', event_count: events.length }) });
    if (!ver.ok) return json({ error: `版を作れません: ${await ver.text()}` }, 502);
    const versionId = ((await ver.json()) as { id: string }[])[0].id;
    const rows = events.map((e) => ({ version_id: versionId, school_id: schoolId, layer_id: calendarId, uid: e.uid, category: e.category, slots: e.slots?.length ? e.slots : [e.category], date: e.date, end_date: e.endDate ?? null, kind: e.kind, time_start: e.timeStart ?? null, time_end: e.timeEnd ?? null, place: e.place ?? null, title: e.title, note: e.note ?? null, source_ref: e.sourceRef ?? null, confidence: e.confidence ?? null, draft: false }));
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await sb(env, 'events', { method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)) });
      if (!ins.ok) return json({ error: `予定を保存できません: ${await ins.text()}` }, 502);
    }
    // 設定にない班が出てきたら知らせる（画面で「班を追加」できるように）
    const unknown = [...new Set(events.map((e) => e.category))].filter((c) => !layer.slots.includes(c));
    return json({ versionId, count: events.length, model, usage, unknownSlots: unknown, costYen: Math.round((usage.input * 2 + usage.output * 10) / 1_000_000 * 150) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
