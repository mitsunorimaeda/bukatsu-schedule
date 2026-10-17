/**
 * ICS 配信（Cloudflare Pages Functions）
 *   GET /ics/<token>.ics                    共有リンクの範囲すべて（件名の先頭に [カレンダー 班]）
 *   GET /ics/<token>/<calendarId>.ics       1 つのカレンダー
 *   GET /ics/<token>/<calendarId>/<班>.ics  1 つの班（班をまたぐ予定もそれぞれに入る）
 * データは Supabase の RPC schedule_by_token（公開済み・下書き除く・範囲内）から。
 */
import { buildIcs, mergeSpans, normalize } from '../../../../packages/core/src/browser';
import type { ScheduleEvent, ScheduleEventInput } from '../../../../packages/core/src/browser';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}
interface Row {
  school_id: string;
  school_name: string;
  layer_id: string;
  layer_name: string;
  layer_type: ScheduleEvent['layerType'];
  uid: string;
  category: string;
  slots: string[];
  date: string;
  end_date: string | null;
  kind: ScheduleEvent['kind'];
  time_start: string | null;
  time_end: string | null;
  place: string | null;
  title: string;
  note: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const parts = ([] as string[]).concat(params.path as string[] | string).map(decodeURIComponent);
  if (!parts.length) return new Response('not found', { status: 404 });
  const last = parts[parts.length - 1];
  if (!last.endsWith('.ics')) return new Response('not found', { status: 404 });
  parts[parts.length - 1] = last.slice(0, -4);
  const [token, calendarId, slot] = parts;
  if (!/^[0-9a-f]{32,}$/i.test(token)) return new Response('bad token', { status: 400 });

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/schedule_by_token`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'bukatsu' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
  let rows = (await res.json()) as Row[];
  if (!rows.length) return new Response('このリンクは無効か、公開された予定がありません', { status: 404 });
  if (calendarId) rows = rows.filter((r) => r.layer_id === calendarId);
  if (slot) rows = rows.filter((r) => (r.slots?.length ? r.slots : [r.category]).includes(slot));

  const inputs: ScheduleEventInput[] = rows.map((r) => ({
    school: r.school_id,
    layer: r.layer_id,
    layerType: r.layer_type,
    category: slot ?? (r.slots?.length ? r.slots[0] : r.category),
    date: r.date,
    endDate: r.end_date ?? undefined,
    kind: r.kind,
    timeStart: r.time_start?.slice(0, 5),
    timeEnd: r.time_end?.slice(0, 5),
    place: r.place ?? undefined,
    // 全体フィードでは「[サッカー部 セカンド] 練習」のように出どころが分かる件名にする
    title: calendarId ? r.title : `[${r.layer_name}${(r.slots?.length ? r.slots : [r.category])[0] !== '全体' && !slot ? ' ' + (r.slots?.length ? r.slots.join('・') : r.category) : ''}] ${r.title}`,
    note: r.note ?? undefined,
    sourceRef: `uid:${r.uid}`,
  }));
  // uid は元の値を使う（更新時にカレンダー側で上書きされるように）
  const events = normalize(inputs).map((e, i) => ({ ...e, uid: `${rows[i]?.uid ?? e.uid}${slot ? `#${slot}` : ''}` }));
  const schoolName = rows[0].school_name;
  const calName = calendarId ? rows[0].layer_name : '予定表';
  const ics = buildIcs(mergeSpans(events), { calendarName: `${schoolName} ${calName}${slot ? ' ' + slot : ''}`, prefixCategory: false, version: new Date().toISOString().slice(0, 10) });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${encodeURIComponent(calName)}.ics"`,
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
