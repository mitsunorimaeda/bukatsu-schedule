import { useEffect, useState } from 'react';
import { createWorkspace, listWorkspaces, signInWithEmail, signInWithPassword, signOut, type WorkspaceSummary } from './api';
import { slugify } from './model';
import { Panel, useToast } from './ui';
import { HelpPanel } from './panels/HelpPanel';
import { DataPanel } from './panels/DataPanel';

export function Home({ email, onOpen, onTour }: { email?: string; onOpen: (id: string) => void; onTour: (id: string) => void }) {
  const toast = useToast();
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [err, setErr] = useState<string>();
  const [panel, setPanel] = useState<'none' | 'new' | 'help' | 'data'>('none');
  const [name, setName] = useState('');
  const [welcome, setWelcome] = useState(() => {
    try {
      return localStorage.getItem('bukatsu:welcome') !== 'off';
    } catch {
      return true;
    }
  });
  const reload = () => listWorkspaces().then(setList).catch((e) => setErr(e.message));
  useEffect(() => {
    reload();
  }, []);

  const create = async () => {
    try {
      const id = await createWorkspace(slugify(name), name.trim() || '新しい予定表');
      toast(`「${name.trim() || '新しい予定表'}」を作りました。まずカレンダーを 1 つ作りましょう`);
      setPanel('none');
      onOpen(id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="app">
      <header className="top">
        <span className="brand">
          予定表<small>学校・部活・家族の予定をまとめる</small>
        </span>
        <span className="spacer" />
        <button className="ghost" onClick={() => setPanel('help')}>
          ？ 使い方
        </button>
        <button className="ghost" onClick={() => setPanel('data')}>
          データの扱い
        </button>
        <span className="hint">{email}</span>
        <button className="ghost" onClick={() => signOut()}>
          ログアウト
        </button>
      </header>
      <div className="home">
        <h1>予定表の一覧</h1>
        <p className="lead">学校、部活、職場、家族。ひとつの予定表の中に、カレンダーをいくつでも重ねられます。</p>
        {welcome && (
          <div className="welcome">
            <b>はじめての方へ</b>
            <div>3 分で一通り触れます。予定表を開くと、画面の中で順番に案内します。自分の予定表はいつでも作れます。</div>
            <div className="acts">
              {list && list.length > 0 && (
                <button className="primary" onClick={() => onTour(list[0].id)}>
                  「{list[0].name}」で案内を見る（約 3 分）
                </button>
              )}
              <button onClick={() => setPanel('new')}>自分の予定表を作る</button>
              <button className="ghost" onClick={() => setPanel('help')}>
                使い方例を読む
              </button>
              <span className="spacer" />
              <button
                className="ghost"
                onClick={() => {
                  setWelcome(false);
                  try {
                    localStorage.setItem('bukatsu:welcome', 'off');
                  } catch {
                    /* ignore */
                  }
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        {list === null ? (
          <p className="hint">読み込み中…</p>
        ) : (
          <div className="wsgrid">
            {list.map((w) => (
              <button key={w.id} className="ws" onClick={() => onOpen(w.id)}>
                <b>{w.name}</b>
                <div className="hint">
                  {w.calendars.length} カレンダー ・ {{ admin: '管理者', teacher: '編集', viewer: '閲覧' }[w.role]}
                </div>
                <div className="chips">
                  {w.calendars.map((c) => (
                    <span key={c.id} className="chip" style={{ background: c.color }}>
                      {c.name}
                    </span>
                  ))}
                </div>
              </button>
            ))}
            <button className="ws new" onClick={() => setPanel('new')}>
              ＋ 予定表を作る
            </button>
          </div>
        )}
        <h2 style={{ fontSize: 14, margin: '28px 0 8px', color: 'var(--muted)' }}>ゼロから作るときの流れ</h2>
        <ol className="hint" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>「予定表を作る」で名前を決める（例: 〇〇高校、〇〇家）</li>
          <li>「＋ カレンダー」で部活や行事の単位を作る。班（トップ/セカンドなど）もここで</li>
          <li>入れ方を選ぶ: 表に直接書く / いつもの PDF を読ませる / Google シートをつなぐ</li>
          <li>「共有・出力」で、見せたい人に見せたい分だけリンク・ICS・PDF にする</li>
        </ol>
      </div>
      {panel === 'new' && (
        <Panel title="予定表を作る" onClose={() => setPanel('none')}>
          <p className="hint">あとから何でも変えられます。まずは名前だけ。</p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label>
              名前
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 〇〇高校、〇〇家、営業1課" autoFocus />
            </label>
            {err && <div className="error">{err}</div>}
            <button className="primary" type="submit" disabled={!name.trim()}>
              作る
            </button>
          </form>
        </Panel>
      )}
      {panel === 'data' && <DataPanel onClose={() => setPanel('none')} />}
      {panel === 'help' && <HelpPanel onClose={() => setPanel('none')} onTour={() => list?.[0] && onTour(list[0].id)} />}
    </div>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app">
      <header className="top">
        <span className="brand">
          予定表<small>学校・部活・家族の予定をまとめる</small>
        </span>
      </header>
      <div className="home" style={{ maxWidth: 440 }}>
        <h1>ログイン</h1>
        <p className="lead">先生・顧問・保護者向け。メールアドレスだけで入れます。閲覧だけなら共有リンクで足ります。</p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => signInWithEmail(email), 'ログイン用のリンクをメールで送りました。メールのリンクを開いてください。');
          }}
        >
          <label>
            メールアドレス
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <button className="primary" type="submit" disabled={busy || !email}>
            メールでログイン リンクを受け取る
          </button>
          <details>
            <summary className="hint">パスワードでログイン</summary>
            <label>
              パスワード
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <button type="button" disabled={busy || !email || !password} onClick={() => run(() => signInWithPassword(email, password), 'ログインしました')}>
              ログイン
            </button>
          </details>
          {msg && <p className="notice">{msg}</p>}
        </form>
      </div>
    </div>
  );
}
