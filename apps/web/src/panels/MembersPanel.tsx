import { useEffect, useState } from 'react';
import { inviteMember, listMembers, type Member } from '../api';
import type { Workspace } from '../model';
import { Panel, SlotPick, useToast } from '../ui';

export function MembersPanel({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('teacher');
  const [grants, setGrants] = useState<Record<string, string[] | null>>({});
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reload = () => listMembers(ws.id).then(setMembers).catch((e) => setErr(e.message));
  useEffect(() => {
    reload();
  }, [ws.id]);
  const name = (id: string) => ws.calendars.find((c) => c.id === id)?.name ?? id;

  const invite = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await inviteMember(ws.id, email.trim(), role, role === 'teacher' && Object.keys(grants).length ? grants : null);
      toast(r === 'member' ? `${email} をメンバーにしました` : `${email} を招待しました。ログインすると自動で参加します`);
      setEmail('');
      setGrants({});
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="メンバー" onClose={onClose}>
      <p className="hint">メールで招待。誰がどのカレンダー・班を書けるかを決めます。見るだけの人は共有リンクで足ります。</p>
      {ws.role !== 'admin' && <p className="notice">招待は管理者だけができます。</p>}
      <div className="form">
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coach@example.jp" disabled={ws.role !== 'admin'} />
        </label>
        <label>
          役割
          <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} disabled={ws.role !== 'admin'}>
            <option value="teacher">編集（先生・顧問）</option>
            <option value="admin">管理者</option>
            <option value="viewer">閲覧のみ</option>
          </select>
        </label>
        {role === 'teacher' && (
          <>
            <div className="hint">編集できる範囲</div>
            <div className="choices">
              {ws.calendars.map((c) => {
                const on = c.id in grants;
                return (
                  <div key={c.id} className={`choice${on ? ' on' : ''}`} style={{ padding: '6px 10px', display: 'grid', gap: 4 }}>
                    <label style={{ display: 'grid', gridTemplateColumns: '16px 12px 1fr', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const g = { ...grants };
                          if (on) delete g[c.id];
                          else g[c.id] = null;
                          setGrants(g);
                        }}
                        style={{ margin: 0 }}
                      />
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color }} />
                      <b>{c.name}</b>
                    </label>
                    {on && c.slots.length > 1 && (
                      <div style={{ marginLeft: 34 }}>
                        <SlotPick slots={c.slots} value={grants[c.id] ?? c.slots} onChange={(v) => setGrants({ ...grants, [c.id]: v.length === c.slots.length ? null : v })} title="書ける班" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {err && <div className="error">{err}</div>}
        <button className="primary" onClick={invite} disabled={busy || !email.trim() || ws.role !== 'admin'}>
          招待する
        </button>
        <p className="hint">招待した人は、このアプリにそのメールでログインすると自動で参加します（Bekuta のアカウントがあればそれでも入れます）。</p>
      </div>
      <h3 style={{ fontSize: 13, marginTop: 14 }}>いるメンバー</h3>
      <ul className="members" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {members.map((m, i) => (
          <li key={i}>
            <div className="who">
              <b>{m.email}</b>
              {m.pending && <span className="badge">招待中</span>}
              <small>
                {{ admin: '管理者', teacher: '編集', viewer: '閲覧' }[m.role]}
                {m.grants && Object.keys(m.grants).length ? ` ・ ${Object.entries(m.grants).map(([k, v]) => (v ? `${name(k)}（${v.join('・')}）` : name(k))).join('、')}` : m.role === 'admin' ? ' ・ すべて' : ''}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
