import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteEvent, loadByToken, loadWorkspace, saveEvent, signOut } from './api';
import { CellEditor } from './CellEditor';
import { MonthTable, type ColumnCal } from './MonthTable';
import { Tour } from './Tour';
import { draftCount, fmtMonth, publicEvents, shiftMonth, todayYm, unpublishedChanges, type Calendar, type Change, type UiEvent, type Workspace as Ws } from './model';
import { CalendarPanel } from './panels/CalendarPanel';
import { HelpPanel } from './panels/HelpPanel';
import { ImportPanel } from './panels/ImportPanel';
import { MembersPanel } from './panels/MembersPanel';
import { DataPanel } from './panels/DataPanel';
import { ApprovePanel, PublishPanel } from './panels/PublishPanel';
import { SharePanel } from './panels/SharePanel';
import { useToast } from './ui';

type PanelState =
  | { kind: 'none' }
  | { kind: 'data' }
  | { kind: 'addcal' }
  | { kind: 'calset'; calId: string; addSlot?: boolean }
  | { kind: 'import'; calId?: string }
  | { kind: 'share' }
  | { kind: 'members' }
  | { kind: 'help' }
  | { kind: 'publish'; calId: string }
  | { kind: 'approve'; calId: string };

function loadPref<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(`bukatsu:${k}`);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function savePref<T>(k: string, v: T) {
  try {
    localStorage.setItem(`bukatsu:${k}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function WorkspaceView({ id, token, email, startTour, onBack }: { id?: string; token?: string; email?: string; startTour?: boolean; onBack: () => void }) {
  const toast = useToast();
  const key = token ? `t:${token.slice(0, 8)}` : id!;
  const [ws, setWs] = useState<Ws | null>(null);
  const [err, setErr] = useState<string>();
  const [month, setMonth] = useState(() => loadPref('month', todayYm()));
  const [hidden, setHidden] = useState<string[]>(() => loadPref(`hidden:${key}`, [] as string[]));
  const [hiddenSlots, setHiddenSlots] = useState<string[]>(() => loadPref(`hiddenSlots:${key}`, [] as string[]));
  const [publicOnly, setPublicOnly] = useState(false);
  const [diffCal, setDiffCal] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' });
  const [editing, setEditing] = useState<{ cal: Calendar; slot: string; date: string; rect: DOMRect; candidates: UiEvent[]; siblings: UiEvent[] } | null>(null);
  const [tour, setTour] = useState(!!startTour);

  const reload = useCallback(async () => {
    try {
      setErr(undefined);
      setWs(token ? await loadByToken(token) : await loadWorkspace(id!));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id, token]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => savePref('month', month), [month]);
  useEffect(() => savePref(`hidden:${key}`, hidden), [hidden, key]);
  useEffect(() => savePref(`hiddenSlots:${key}`, hiddenSlots), [hiddenSlots, key]);

  const readOnly = !!token;
  const canEdit = (c: Calendar, slot?: string) => {
    if (readOnly || !ws) return false;
    if (ws.role === 'admin') return true;
    if (!(c.id in ws.grants)) return false;
    const g = ws.grants[c.id];
    return !slot || g === null || g.includes(slot);
  };
  const canManage = !readOnly && !!ws && (ws.role === 'admin' || ws.role === 'teacher');

  const visible = useMemo(() => (ws ? ws.calendars.filter((c) => !hidden.includes(c.id)) : []), [ws, hidden]);
  const columns: ColumnCal[] = useMemo(
    () =>
      visible
        .map((c) => {
          const slots = c.slots.filter((s) => !hiddenSlots.includes(`${c.id}|${s}`));
          let events = publicOnly || readOnly ? publicEvents(c) : c.events;
          let changes: Map<string, Change> | undefined;
          if (diffCal === c.id && c.pending) {
            events = c.pending.events;
            changes = new Map(c.pending.changes.map((x) => [(x.after ?? x.before)!.uid, x]));
          } else if (diffCal === c.id && c.previous) {
            changes = new Map(diffList(c.previous.events, events).map((x) => [(x.after ?? x.before)!.uid, x]));
          }
          return { cal: c, slots, events, changes, editable: canEdit(c) };
        })
        .filter((c) => c.slots.length),
    [visible, hiddenSlots, publicOnly, readOnly, diffCal, ws],
  );
  const holidays = useMemo(() => {
    const s = new Set<string>();
    for (const c of columns) for (const e of c.events) if (e.kind === 'holiday') s.add(e.date);
    return s;
  }, [columns]);

  if (err) return <div style={{ padding: 20 }}>{err}</div>;
  if (!ws) return <div style={{ padding: 20 }}>読み込み中…</div>;

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const pendings = ws.calendars.filter((c) => c.pending);
  const calOf = (cid: string) => ws.calendars.find((c) => c.id === cid)!;

  const onCell = (cal: Calendar, slot: string, date: string, el: HTMLElement, events: UiEvent[], siblings: UiEvent[]) => {
    if (!canEdit(cal, slot)) return;
    setEditing({ cal, slot, date, rect: el.getBoundingClientRect(), candidates: events, siblings });
  };

  return (
    <div className="app">
      <header className="top">
        {!readOnly && (
          <button className="ghost" onClick={onBack}>
            ‹ 一覧
          </button>
        )}
        <span className="brand">
          {ws.name}
          <small>予定表</small>
        </span>
        <span className="spacer" />
        {ws.role === 'admin' && !readOnly && <button onClick={() => setPanel({ kind: 'addcal' })}>＋ カレンダー</button>}
        {canManage && (
          <button data-tour="import" onClick={() => setPanel({ kind: 'import' })}>
            PDF・シートを取り込む
          </button>
        )}
        <button className="primary" data-tour="share" onClick={() => setPanel({ kind: 'share' })}>
          共有・出力
        </button>
        {!readOnly && (
          <button data-tour="members" onClick={() => setPanel({ kind: 'members' })}>
            メンバー
          </button>
        )}
        <button className="ghost" onClick={() => setPanel({ kind: 'help' })}>
          ？ 使い方
        </button>
        {!readOnly && (
          <>
            <button className="ghost" title="どこに保存され、誰が見られるか。書き出しと全削除" onClick={() => setPanel({ kind: 'data' })}>
              データ
            </button>
            <span className="hint">{email}</span>
            <button className="ghost" onClick={() => signOut()}>
              ログアウト
            </button>
          </>
        )}
        {readOnly && <span className="hint">閲覧リンク（公開されている予定だけ）</span>}
      </header>

      <div className="layout">
        <aside className="side">
          {pendings.map((c) => (
            <div className="pending" key={c.id}>
              <b>確認待ち</b>
              <div>
                {c.name}「{c.pending!.version.label}」{c.pending!.events.length} 件
              </div>
              <div className="hint">公開中との違い {c.pending!.changes.length} 件。問題なければ反映します。</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => setDiffCal(diffCal === c.id ? null : c.id)}>{diffCal === c.id ? '違いを消す' : '違いを見る'}</button>
                {canManage && (
                  <button className="primary" onClick={() => setPanel({ kind: 'approve', calId: c.id })}>
                    確認して反映
                  </button>
                )}
              </div>
            </div>
          ))}
          <h2>カレンダー</h2>
          {ws.calendars.length === 0 && <p className="hint">まだありません。右上の「＋ カレンダー」から作ります。</p>}
          {ws.calendars.map((c) => {
            const on = !hidden.includes(c.id);
            const evs = publicOnly || readOnly ? publicEvents(c) : c.events;
            const cnt = (s: string) => evs.filter((e) => e.slots.includes(s)).length;
            const unpub = unpublishedChanges(c).length;
            const dn = draftCount(c);
            return (
              <div className="cal" key={c.id}>
                <div className="row">
                  <input type="checkbox" id={`t-${c.id}`} checked={on} onChange={() => setHidden(toggle(hidden, c.id))} />
                  <span className="sw" style={{ background: c.color }} />
                  <label className="name" htmlFor={`t-${c.id}`} title={c.name}>
                    {c.name}
                  </label>
                  <span className="n">{evs.length}</span>
                  {canEdit(c) && !readOnly ? (
                    <button className="gear" title="名前・色・班を変える" onClick={() => setPanel({ kind: 'calset', calId: c.id })}>
                      ⚙
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                {on && c.slots.length > 1 && (
                  <>
                    <div className="row allnone">
                      <button onClick={() => setHiddenSlots(hiddenSlots.filter((k) => !k.startsWith(`${c.id}|`)))}>班をすべて表示</button>
                      <button onClick={() => setHiddenSlots([...new Set([...hiddenSlots, ...c.slots.map((s) => `${c.id}|${s}`)])])}>すべて隠す</button>
                    </div>
                    {c.slots.map((s) => (
                      <div className="row slot" key={s}>
                        <input type="checkbox" id={`s-${c.id}-${s}`} checked={!hiddenSlots.includes(`${c.id}|${s}`)} onChange={() => setHiddenSlots(toggle(hiddenSlots, `${c.id}|${s}`))} />
                        <span className="sw" />
                        <label className="name" htmlFor={`s-${c.id}-${s}`}>
                          {s}
                        </label>
                        <span className="n">{cnt(s)}</span>
                        <span />
                      </div>
                    ))}
                  </>
                )}
                {on && !readOnly && c.previous && !c.pending && (
                  <div className="ver">
                    <label>
                      <input type="checkbox" checked={diffCal === c.id} onChange={() => setDiffCal(diffCal === c.id ? null : c.id)} />
                      前の版「{c.previous.version.label}」との違いを色で見る
                    </label>
                  </div>
                )}
                {on && !readOnly && (c.publishMode === 'manual' || dn > 0) && (
                  <div className="pubbar">
                    {c.publishMode === 'manual' &&
                      (unpub ? (
                        <>
                          <span className="dot" />
                          <span>未公開の変更 {unpub} 件</span>
                          {canEdit(c) && (
                            <button className="primary" onClick={() => setPanel({ kind: 'publish', calId: c.id })}>
                              公開する
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="hint">公開済み（手動公開）</span>
                      ))}
                    {dn > 0 && <span className="hint">下書き {dn} 件は公開されません</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <div className="cal" style={{ border: 'none', paddingTop: 4 }}>
              <label className="row" style={{ gridTemplateColumns: '18px 1fr' }}>
                <input type="checkbox" checked={publicOnly} onChange={(e) => setPublicOnly(e.target.checked)} />
                <span className="name" style={{ fontWeight: 400 }}>
                  公開されている内容だけで見る
                </span>
              </label>
              <div className="hint" style={{ marginLeft: 24 }}>
                生徒・保護者に見えている状態を確認できます
              </div>
            </div>
          )}
          <h2>使い方</h2>
          <p className="hint">
            {readOnly ? 'このリンクでは公開されている予定だけが見えます。「共有・出力」からスマホのカレンダーに追加や PDF ができます。' : '表のマスをクリックすると書けます。チェックで表示を切り替え。右上の「共有・出力」で、選んだカレンダーだけのリンク・ICS・PDF を作れます。'}
          </p>
        </aside>

        <main className="main">
          <div className="toolbar">
            <button onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
            <span className="month">{fmtMonth(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            <button className="ghost" onClick={() => setMonth(todayYm())}>
              今月
            </button>
            <span className="legend">
              <span>
                <i style={{ background: 'var(--added)' }} />
                追加
              </span>
              <span>
                <i style={{ background: 'var(--marker)' }} />
                変更
              </span>
              <span>
                <i style={{ background: 'var(--removed)' }} />
                取消
              </span>
            </span>
            <span className="spacer" />
            {!readOnly && (
              <span className="hint">
                マスをクリックで入力。<span className="kbd">Enter</span> 保存、<span className="kbd">Esc</span> 取消
              </span>
            )}
          </div>
          {ws.calendars.length === 0 ? (
            <div className="empty">
              <h3>まだカレンダーがありません</h3>
              <p>「カレンダー」は部活・学校行事・外部予定などの単位です。まず 1 つ作りましょう。</p>
              <div className="acts">
                <button className="primary" onClick={() => setPanel({ kind: 'addcal' })}>
                  ＋ カレンダーを作る
                </button>
              </div>
            </div>
          ) : (
            <>
              {columns.every((c) => !c.events.some((e) => e.date.startsWith(month) || (e.endDate ?? '') >= `${month}-01`)) && (
                <div className="empty" style={{ marginBottom: 10 }}>
                  <h3>{fmtMonth(month)}はまだ空です</h3>
                  <p>{readOnly ? 'この期間に公開された予定はありません。' : '表のマスをクリックして直接書くか、PDF・シートを取り込んでください。'}</p>
                </div>
              )}
              <MonthTable month={month} columns={columns} holidays={holidays} editing={editing ? { calId: editing.cal.id, slot: editing.slot, date: editing.date } : null} onCell={onCell} onAddSlot={readOnly ? undefined : (c) => setPanel({ kind: 'calset', calId: c.id, addSlot: true })} />
            </>
          )}
        </main>
      </div>

      {editing && (
        <CellEditor
          cal={editing.cal}
          slot={editing.slot}
          date={editing.date}
          anchor={editing.rect}
          candidates={editing.candidates}
          siblings={editing.siblings}
          settings={ws.settings}
          onSave={async (e, applyToSiblings) => {
            await saveEvent(ws.id, editing.cal, e);
            // 班ごとに別々に保存されている同じ内容も一緒に直す
            if (applyToSiblings) for (const s of editing.siblings) await saveEvent(ws.id, editing.cal, { ...e, id: s.id, uid: s.uid, versionId: s.versionId, slots: s.slots });
            await reload();
            toast(e.draft ? '下書きとして保存しました（公開されません）' : editing.cal.publishMode === 'manual' ? '保存しました。「公開する」を押すまで外には出ません' : '保存しました');
          }}
          onDelete={async (e, applyToSiblings) => {
            if (e.id) await deleteEvent(e.id);
            if (applyToSiblings) for (const s of editing.siblings) if (s.id) await deleteEvent(s.id);
            await reload();
            toast('削除しました');
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {panel.kind === 'addcal' && <CalendarPanel ws={ws} onClose={() => setPanel({ kind: 'none' })} onSaved={reload} onImport={(calId) => setPanel({ kind: 'import', calId })} />}
      {panel.kind === 'calset' && <CalendarPanel ws={ws} existing={calOf(panel.calId)} focusNewSlot={panel.addSlot} onClose={() => setPanel({ kind: 'none' })} onSaved={reload} onImport={(calId) => setPanel({ kind: 'import', calId })} />}
      {panel.kind === 'import' && <ImportPanel ws={ws} calId={panel.calId} onClose={() => setPanel({ kind: 'none' })} onDone={reload} />}
      {panel.kind === 'share' && <SharePanel ws={ws} canManage={canManage} token={token} onClose={() => setPanel({ kind: 'none' })} />}
      {panel.kind === 'members' && <MembersPanel ws={ws} onClose={() => setPanel({ kind: 'none' })} />}
      {panel.kind === 'data' && <DataPanel ws={ws} onClose={() => setPanel({ kind: 'none' })} onLeft={onBack} />}
      {panel.kind === 'help' && (
        <HelpPanel
          onClose={() => setPanel({ kind: 'none' })}
          onTour={() => {
            setPanel({ kind: 'none' });
            setTour(true);
          }}
        />
      )}
      {panel.kind === 'publish' && <PublishPanel ws={ws} cal={calOf(panel.calId)} onClose={() => setPanel({ kind: 'none' })} onDone={reload} />}
      {panel.kind === 'approve' && calOf(panel.calId).pending && <ApprovePanel cal={calOf(panel.calId)} onClose={() => setPanel({ kind: 'none' })} onDone={reload} />}
      {tour && (
        <Tour
          onEnd={() => {
            setTour(false);
            toast('案内は右上の「？ 使い方」からいつでも見られます');
          }}
        />
      )}
    </div>
  );
}

/** 2 つの予定の並びの差分（前の版との比較用） */
function diffList(before: UiEvent[], after: UiEvent[]): Change[] {
  const b = new Map(before.map((e) => [e.uid, e]));
  const a = new Map(after.map((e) => [e.uid, e]));
  const sig = (e: UiEvent) => JSON.stringify([e.title, e.timeStart, e.timeEnd, e.date, e.endDate, e.place, e.kind, [...e.slots].sort()]);
  const out: Change[] = [];
  for (const [uid, e] of a) {
    const p = b.get(uid);
    if (!p) out.push({ type: 'added', after: e });
    else if (sig(p) !== sig(e)) out.push({ type: 'changed', before: p, after: e });
  }
  for (const [uid, p] of b) if (!a.has(uid)) out.push({ type: 'removed', before: p });
  return out;
}
