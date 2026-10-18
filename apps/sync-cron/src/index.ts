/** 定期実行: Pages の /api/sync を叩く。中身の処理は Pages 側（apps/web/functions/api/sync.ts） */
interface Env {
  SYNC_URL: string;
  SYNC_KEY: string;
}
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const res = await fetch(env.SYNC_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.SYNC_KEY}` } });
        console.log('sync', res.status, (await res.text()).slice(0, 500));
      })(),
    );
  },
  // 手で確かめる用: 同じ合言葉を付けて GET / → いま実行。無ければ 404
  async fetch(req: Request, env: Env): Promise<Response> {
    if ((req.headers.get('Authorization') ?? '') !== `Bearer ${env.SYNC_KEY}`) return new Response('not found', { status: 404 });
    const res = await fetch(env.SYNC_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.SYNC_KEY}` } });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  },
};
