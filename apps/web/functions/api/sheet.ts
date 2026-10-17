/**
 * Google シート / CSV の取り込み用に、サーバー側で CSV を取りに行く。
 *   POST /api/sheet  JSON { schoolId, calendarId?, url }   Authorization: Bearer <ユーザーの JWT>
 * ブラウザから直接だと CORS で読めないことがあるため。中身は保存せず、そのまま返す（保存するのは画面で選んだ列だけ）。
 */
interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userJwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!userJwt) return json({ error: 'ログインが必要です' }, 401);
    const { schoolId, calendarId, url } = (await request.json()) as { schoolId?: string; calendarId?: string; url?: string };
    if (!schoolId || !url) return json({ error: 'schoolId と url が必要です' }, 400);
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return json({ error: 'URL の形が正しくありません' }, 400);
    }
    if (target.protocol !== 'https:') return json({ error: 'https の URL だけ使えます' }, 400);
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(target.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname)) return json({ error: 'その URL には行けません' }, 400);

    // 権限: そのカレンダー（新規なら管理者）を編集できるか
    const can = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_edit`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${userJwt}`, 'Content-Type': 'application/json', 'Content-Profile': 'bukatsu' },
      body: JSON.stringify({ sid: schoolId, lid: calendarId ?? '*', cat: '*' }),
    });
    if (!can.ok || (await can.json()) !== true) return json({ error: 'このカレンダーを編集する権限がありません' }, 403);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(target.toString(), { redirect: 'follow', signal: ac.signal, headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'bukatsu-schedule/1 (+sheet import)' } });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return json({ error: `取りに行けませんでした（HTTP ${res.status}）。シートが公開されているか確かめてください` }, 502);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 5 * 1024 * 1024) return json({ error: 'ファイルが大きすぎます（5MB まで）' }, 413);
    const text = await res.text();
    if (text.length > 5 * 1024 * 1024) return json({ error: 'ファイルが大きすぎます（5MB まで）' }, 413);
    if (/^\s*<(!doctype|html)/i.test(text)) return json({ error: 'CSV ではなく Web ページが返ってきました。Google シートなら「共有」→「リンクを知っている全員」を閲覧可にするか、「ファイル → 共有 → ウェブに公開」で CSV を選んだ URL を貼ってください' }, 422);
    return json({ csv: text, finalUrl: res.url, contentType: res.headers.get('content-type') });
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? '時間内に取りに行けませんでした' : (e as Error).message;
    return json({ error: msg }, 500);
  }
};
