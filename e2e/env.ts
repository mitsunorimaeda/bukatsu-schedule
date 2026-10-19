/** ローカルの接続先と鍵を apps/web/.dev.vars から読む。本番に向いていたら止める */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd(); // npm run e2e はリポジトリの直下で動く
export const STATE_FILE = resolve(ROOT, 'e2e/.state.json');

export function localEnv() {
  const text = readFileSync(resolve(ROOT, 'apps/web/.dev.vars'), 'utf8');
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
  const url = get('SUPABASE_URL');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`画面の自動確認はローカル Supabase 専用です（SUPABASE_URL=${url || '未設定'}）`);
  return { url, anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}

export interface E2EState {
  userId: string;
  email: string;
  password: string;
}
export const saveState = (s: E2EState) => writeFileSync(STATE_FILE, JSON.stringify(s));
export const loadState = (): E2EState | null => (existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState) : null);

/** service_role で bukatsu スキーマの REST を叩く（テストの準備と後片付け用） */
export async function rest(path: string, init: RequestInit = {}) {
  const e = localEnv();
  return fetch(`${e.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: e.service, Authorization: `Bearer ${e.service}`, 'Content-Type': 'application/json', 'Accept-Profile': 'bukatsu', 'Content-Profile': 'bukatsu', ...(init.headers as Record<string, string> | undefined) },
  });
}
