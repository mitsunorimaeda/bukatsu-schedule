import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange, supabase } from './api';
import { Home, LoginScreen } from './Home';
import { WorkspaceView } from './Workspace';
import { PrintView } from './PrintView';
import { ToastProvider } from './ui';

const PARAMS = new URLSearchParams(location.search);
const TOKEN = PARAMS.get('token');

/**
 * 3 つの入口
 *  - ?token=…  : 共有リンク。ログイン不要、公開されている予定だけ
 *  - ログイン済み: 予定表の一覧 → 予定表
 *  - 未ログイン : ログイン画面
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<{ kind: 'home' } | { kind: 'ws'; id: string; tour?: boolean }>(() => {
    const h = location.hash.replace(/^#/, '');
    return h.startsWith('ws/') ? { kind: 'ws', id: decodeURIComponent(h.slice(3)) } : { kind: 'home' };
  });
  useEffect(() => {
    getSession().then(setSession);
    return onAuthChange(setSession);
  }, []);
  useEffect(() => {
    try {
      location.hash = route.kind === 'ws' ? `ws/${encodeURIComponent(route.id)}` : '';
    } catch {
      /* ignore */
    }
  }, [route]);

  const printKey = location.hash.startsWith('#print/') ? location.hash.slice(7) : null;
  if (printKey) return <PrintView jobKey={printKey} />;
  if (TOKEN) {
    return (
      <ToastProvider>
        <WorkspaceView token={TOKEN} onBack={() => undefined} />
      </ToastProvider>
    );
  }
  if (!supabase()) return <div style={{ padding: 20 }}>接続設定（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）がありません。apps/web/.env.local を確認してください。</div>;
  if (session === undefined) return <div style={{ padding: 20 }}>読み込み中…</div>;
  if (!session) return <LoginScreen />;
  return (
    <ToastProvider>
      {route.kind === 'home' ? (
        <Home email={session.user.email} onOpen={(id) => setRoute({ kind: 'ws', id })} onTour={(id) => setRoute({ kind: 'ws', id, tour: true })} />
      ) : (
        <WorkspaceView key={route.id} id={route.id} email={session.user.email} startTour={route.tour} onBack={() => setRoute({ kind: 'home' })} />
      )}
    </ToastProvider>
  );
}
