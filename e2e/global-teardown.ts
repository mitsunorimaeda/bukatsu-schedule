/** テスト用の利用者と、その人が作った予定表を消す */
import { rmSync } from 'node:fs';
import { STATE_FILE, loadState, localEnv, rest } from './env';

export default async function globalTeardown() {
  const s = loadState();
  if (!s) return;
  const e = localEnv();
  const m = await rest(`memberships?user_id=eq.${s.userId}&select=school_id`);
  const ids = m.ok ? ((await m.json()) as { school_id: string }[]).map((x) => x.school_id) : [];
  if (ids.length) await rest(`schools?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
  await fetch(`${e.url}/auth/v1/admin/users/${s.userId}`, { method: 'DELETE', headers: { apikey: e.service, Authorization: `Bearer ${e.service}` } });
  rmSync(STATE_FILE, { force: true });
}
