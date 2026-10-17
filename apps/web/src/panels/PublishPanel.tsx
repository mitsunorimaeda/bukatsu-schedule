import { useState } from 'react';
import { publishCalendar, approveVersion, setVersionStatus } from '../api';
import { changeLine, draftCount, unpublishedChanges, type Calendar, type Change, type Workspace } from '../model';
import { Panel, copyText, useToast } from '../ui';

/** 手動公開: いま公開するとこう変わる、を見せてから公開 */
export function PublishPanel({ ws, cal, onClose, onDone }: { ws: Workspace; cal: Calendar; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const ch = unpublishedChanges(cal);
  const dn = draftCount(cal);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const text = ch.map(changeLine).join('\n');
  return (
    <Panel title={`${cal.name} を公開する`} onClose={onClose}>
      <p className="hint">公開すると、閲覧リンク・ICS・PDF にこの内容が反映されます。下書き {dn} 件は含まれません。</p>
      <ChangeList changes={ch} />
      {err && <div className="error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          className="primary"
          disabled={busy || !ch.length}
          onClick={async () => {
            setBusy(true);
            try {
              await publishCalendar(ws.id, cal);
              await onDone();
              toast('公開しました。リンク・ICS・PDF に反映されます');
              onClose();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          公開する（{ch.length} 件）
        </button>
        <button onClick={() => copyText(text, toast)} disabled={!ch.length}>
          通知文をコピー
        </button>
        <button onClick={onClose}>あとで</button>
      </div>
    </Panel>
  );
}

/** 取り込みの確認待ち: 前の版との違いを見て反映 / 却下 */
export function ApprovePanel({ cal, onClose, onDone }: { cal: Calendar; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const p = cal.pending!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const text = p.changes.map(changeLine).join('\n');
  return (
    <Panel title={`${cal.name}「${p.version.label}」を確認`} onClose={onClose}>
      <p className="hint">
        読み取った {p.events.length} 件。公開中の内容との違いは {p.changes.length} 件（月間表でも色で出ています）。
      </p>
      <p className="hint">
        反映すると <b>{p.months.map((m) => `${Number(m.slice(5))}月`).join('・')}</b> の内容がこの版に入れ替わります。他の月の公開内容はそのまま残ります。
      </p>
      <ChangeList changes={p.changes} />
      {err && <div className="error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await approveVersion(p.version.id);
              await onDone();
              toast('反映しました。リンク・ICS・PDF にも反映されます');
              onClose();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          反映する
        </button>
        <button onClick={() => copyText(text, toast)} disabled={!p.changes.length}>
          通知文をコピー
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await setVersionStatus(p.version.id, 'rejected');
              await onDone();
              toast('却下しました');
              onClose();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          却下
        </button>
      </div>
    </Panel>
  );
}

export function ChangeList({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="hint">変更はありません</p>;
  return (
    <ul style={{ paddingLeft: 18, maxHeight: '50vh', overflow: 'auto' }}>
      {changes.map((x, i) => (
        <li key={i}>{changeLine(x)}</li>
      ))}
    </ul>
  );
}
