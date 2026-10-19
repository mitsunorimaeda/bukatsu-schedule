/** テスト用の利用者を毎回新しく作る（ローカル Supabase のみ）。パスワードはその場で作り、e2e/.state.json（Git 管理外）に置く */
import { randomBytes } from 'node:crypto';
import { localEnv, saveState } from './env';

export default async function globalSetup() {
  const e = localEnv();
  const health = await fetch(`${e.url}/auth/v1/health`, { headers: { apikey: e.anon } }).catch(() => null);
  if (!health?.ok) throw new Error(`ローカル Supabase（${e.url}）に繋がりません。Docker Desktop と supabase start を確かめてください`);
  const email = `e2e-${Date.now().toString(36)}@example.test`;
  const password = randomBytes(18).toString('base64url');
  const res = await fetch(`${e.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: e.service, Authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`テスト用の利用者を作れません: ${res.status} ${await res.text()}`);
  const user = (await res.json()) as { id: string };
  saveState({ userId: user.id, email, password });
}
