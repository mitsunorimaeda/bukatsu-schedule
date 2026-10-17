import { useState } from 'react';
import type { LayerType } from '@bukatsu/core/browser';
import { remapSlots, saveCalendar, deleteCalendar, type CalendarInput } from '../api';
import type { Calendar, Workspace } from '../model';
import { Panel, useToast } from '../ui';

const SOURCES: { kind: string; title: string; desc: string; soon?: boolean }[] = [
  { kind: 'manual', title: 'この画面で直接書く', desc: '表のマスをクリックして入力。Excel と同じ感覚' },
  { kind: 'pdf', title: 'いつもの PDF・写真を読ませる', desc: 'Excel で作った PDF、紙の写真でも可。AI が表に起こし、確認してから反映。鍵がなくても ChatGPT などの画面経由で可' },
  { kind: 'sheet', title: 'Google シート / CSV をつなぐ（準備中）', desc: '今は設定ファイルと CLI で取り込めます（docs/self-hosting.md）。画面からの登録は準備中', soon: true },
  { kind: 'template', title: '入力用のシートをもらう（準備中）', desc: '日付 × 班のテンプレを配布し、シートから送信する形を準備中', soon: true },
];

/** 追加と設定を 1 つのパネルで。existing があれば設定モード */
export function CalendarPanel({
  ws,
  existing,
  focusNewSlot,
  onClose,
  onSaved,
  onImport,
}: {
  ws: Workspace;
  existing?: Calendar;
  focusNewSlot?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onImport: (calId: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? '#2a7f62');
  const [kind, setKind] = useState(existing?.source?.kind ?? 'manual');
  const [publishMode, setPublishMode] = useState<'auto' | 'manual'>(existing?.publishMode ?? 'auto');
  const [slots, setSlots] = useState<{ old: string | null; name: string; deleting?: boolean; moveTo?: string; drop?: boolean }[]>(
    existing ? existing.slots.map((s) => ({ old: s, name: s })) : [],
  );
  const [slotText, setSlotText] = useState('');
  const [removed, setRemoved] = useState<{ old: string; moveTo?: string; drop?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = (s: string) => (existing ? existing.events.filter((e) => e.slots.includes(s)).length : 0);

  useStateInit(() => {
    if (focusNewSlot && existing) setSlots((v) => [...v, { old: null, name: '' }]);
  });

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      let names: string[];
      if (existing) {
        names = [...new Set(slots.map((s) => s.name.trim()).filter(Boolean))];
        if (!names.length) throw new Error('班は 1 つ以上必要です');
      } else {
        names = slotText.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
        if (!names.length) names = ['全体'];
      }
      if (!name.trim()) throw new Error('名前を入れてください');
      const type: LayerType = existing?.type ?? (kind === 'manual' ? 'manual' : 'club');
      const input: CalendarInput = { id: existing?.id, name: name.trim(), color, type, slots: names, publishMode, source: existing?.source ?? { kind } };
      if (existing) {
        const mapping: Record<string, string | null> = {};
        for (const s of slots) if (s.old && s.old !== s.name.trim()) mapping[s.old] = s.name.trim();
        for (const r of removed) mapping[r.old] = r.drop ? null : r.moveTo ?? names[0];
        if (Object.keys(mapping).length) await remapSlots(ws.id, existing, mapping);
      }
      const id = await saveCalendar(ws.id, input, existing ? undefined : ws.calendars.length);
      await onSaved();
      if (!existing && (kind === 'pdf' || kind === 'sheet')) {
        toast(`「${input.name}」を作りました。続けて取り込みます`);
        onImport(id);
        return;
      }
      toast(existing ? '保存しました。表の列に反映されています' : `「${input.name}」を作りました。表のマスをクリックして書けます`);
      onClose();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, d: number) => {
    const v = [...slots];
    const j = i + d;
    if (j < 0 || j >= v.length) return;
    [v[i], v[j]] = [v[j], v[i]];
    setSlots(v);
  };

  return (
    <Panel title={existing ? `${existing.name} の設定` : 'カレンダーを追加'} onClose={onClose}>
      {!existing && <p className="hint">部活・学校行事・外部予定などの単位です。あとで名前も班も変えられます。</p>}
      <div className="form">
        <div className="row2">
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: サッカー部" autoFocus={!existing} />
          </label>
          <label>
            色
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 34, padding: 2 }} />
          </label>
        </div>
        {!existing && (
          <label>
            班（カンマ区切り、無ければ空）
            <input value={slotText} onChange={(e) => setSlotText(e.target.value)} placeholder="例: トップ, セカンド, 朝練" />
          </label>
        )}
        {existing && (
          <>
            <div className="hint">班（表の列になります。あとから増やしても、入っている予定はそのまま残ります）</div>
            {slots.map((s, i) => (
              <div key={i}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={s.name} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} style={{ flex: 1 }} autoFocus={focusNewSlot && i === slots.length - 1} />
                  <span className="hint" style={{ whiteSpace: 'nowrap' }}>
                    {s.old ? `${count(s.old)} 件` : '新規'}
                  </span>
                  <button className="ghost" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button className="ghost" onClick={() => move(i, 1)} disabled={i === slots.length - 1}>
                    ↓
                  </button>
                  <button
                    className="ghost danger"
                    disabled={slots.length === 1}
                    onClick={() => {
                      if (!s.old || !count(s.old)) setSlots(slots.filter((_, k) => k !== i));
                      else setSlots(slots.map((x, k) => (k === i ? { ...x, deleting: true } : x)));
                    }}
                  >
                    削除
                  </button>
                </div>
                {s.deleting && s.old && (
                  <div className="notice">
                    「{s.old}」には {count(s.old)} 件の予定があります。どこへ移しますか
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <select value={s.moveTo ?? ''} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? { ...x, moveTo: e.target.value } : x)))} style={{ width: 'auto' }}>
                        <option value="">移動先を選ぶ</option>
                        {slots.filter((x) => x !== s).map((x) => (
                          <option key={x.name} value={x.name}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!s.moveTo}
                        onClick={() => {
                          setRemoved([...removed, { old: s.old!, moveTo: s.moveTo }]);
                          setSlots(slots.filter((_, k) => k !== i));
                        }}
                      >
                        移して削除
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setRemoved([...removed, { old: s.old!, drop: true }]);
                          setSlots(slots.filter((_, k) => k !== i));
                        }}
                      >
                        予定ごと削除
                      </button>
                      <button className="ghost" onClick={() => setSlots(slots.map((x, k) => (k === i ? { ...x, deleting: false } : x)))}>
                        やめる
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button onClick={() => setSlots([...slots, { old: null, name: '' }])}>＋ 班を追加</button>
          </>
        )}
        {!existing && (
          <>
            <div className="hint">予定の入れ方</div>
            <div className="choices">
              {SOURCES.map((s) => (
                <label key={s.kind} className={`choice${kind === s.kind ? ' on' : ''}${s.soon ? ' soon' : ''}`}>
                  <input type="radio" name="src" value={s.kind} checked={kind === s.kind} disabled={s.soon} onChange={() => setKind(s.kind)} />
                  <span>
                    <b>{s.title}</b>
                    <small>{s.desc}</small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="hint" style={{ marginTop: 6 }}>
          公開のしかた（リンク・ICS・PDF にいつ反映するか）
        </div>
        <div className="choices">
          <label className={`choice${publishMode === 'auto' ? ' on' : ''}`}>
            <input type="radio" name="pub" checked={publishMode === 'auto'} onChange={() => setPublishMode('auto')} />
            <span>
              <b>自動</b>
              <small>保存したらすぐ反映。下書きにした予定だけは出ない</small>
            </span>
          </label>
          <label className={`choice${publishMode === 'manual' ? ' on' : ''}`}>
            <input type="radio" name="pub" checked={publishMode === 'manual'} onChange={() => setPublishMode('manual')} />
            <span>
              <b>手動</b>
              <small>「公開する」を押した内容だけ反映。それまでは先生の中だけで調整できる</small>
            </span>
          </label>
        </div>
        {err && <div className="error">{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="primary" onClick={save} disabled={busy}>
            {existing ? '保存' : '作る'}
          </button>
          <button onClick={onClose}>やめる</button>
          <span className="spacer" />
          {existing && ws.role === 'admin' && !confirmDelete && (
            <button className="ghost danger" onClick={() => setConfirmDelete(true)}>
              カレンダーを削除
            </button>
          )}
        </div>
        {confirmDelete && existing && (
          <div className="notice">
            「{existing.name}」と、その予定・版・共有範囲をすべて削除します。元に戻せません。
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                className="danger"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await deleteCalendar(ws.id, existing.id);
                    await onSaved();
                    toast('削除しました');
                    onClose();
                  } catch (x) {
                    setErr((x as Error).message);
                    setBusy(false);
                  }
                }}
              >
                削除する
              </button>
              <button className="ghost" onClick={() => setConfirmDelete(false)}>
                やめる
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** 初回描画のときだけ実行する小さな補助 */
function useStateInit(fn: () => void) {
  const [done, setDone] = useState(false);
  if (!done) {
    setDone(true);
    fn();
  }
}
