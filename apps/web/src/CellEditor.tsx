import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, addMinutes } from '@bukatsu/core/browser';
import type { Kind, SchoolSettings } from '@bukatsu/core/browser';
import { WEEKDAYS, md, newUid, spanDays, weekday, type Calendar, type UiEvent } from './model';
import { SlotPick } from './ui';

const KIND_ORDER: Kind[] = ['practice', 'match', 'competition', 'off', 'self', 'pause:test', 'pause:holiday', 'event', 'external_event', 'school_event', 'exam', 'holiday', 'no_class', 'class'];
const ALLDAY = new Set<Kind>(['off', 'self', 'pause:test', 'pause:holiday', 'exam', 'holiday', 'no_class', 'class']);

export function CellEditor({
  cal,
  slot,
  date,
  anchor,
  candidates,
  siblings,
  settings,
  onSave,
  onDelete,
  onClose,
}: {
  cal: Calendar;
  slot: string;
  date: string;
  anchor: DOMRect;
  /** このマスにある予定（複数ならどれを直すか選ぶ） */
  candidates: UiEvent[];
  /** 隣の班に別々に保存されている同じ内容 */
  siblings: UiEvent[];
  settings: SchoolSettings;
  onSave: (e: UiEvent, applyToSiblings: boolean) => Promise<void>;
  onDelete?: (e: UiEvent, applyToSiblings: boolean) => Promise<void>;
  onClose: () => void;
}) {
  // 1 件ならそれを編集、複数ならまず選ぶ、無ければ新規
  const [pick, setPick] = useState<UiEvent | 'new' | null>(candidates.length === 1 ? candidates[0] : candidates.length === 0 ? 'new' : null);
  if (pick === null) {
    return (
      <div className="editor" style={{ left: Math.max(8, Math.min(anchor.left, window.innerWidth - 320)), top: Math.min(anchor.bottom + window.scrollY + 2, window.scrollY + window.innerHeight - 300) }}>
        <div className="form">
          <div className="hint">{md(date)}（{WEEKDAYS[weekday(date)]}）・{cal.name}{cal.slots.length > 1 ? ` ${slot}` : ''}。どれを直しますか</div>
          {candidates.map((e) => (
            <button key={e.uid} onClick={() => setPick(e)} style={{ textAlign: 'left' }}>
              {e.timeStart ? `${e.timeStart}${e.timeEnd ? '〜' + e.timeEnd : ''} ` : '終日 '}
              {e.title}
              {e.draft ? '（下書き）' : ''}
            </button>
          ))}
          <button className="primary" onClick={() => setPick('new')}>
            ＋ この日に別の予定を追加
          </button>
          <button className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    );
  }
  return <CellForm key={pick === 'new' ? 'new' : pick.uid} cal={cal} slot={slot} date={date} anchor={anchor} existing={pick === 'new' ? undefined : pick} siblings={pick === 'new' ? [] : siblings} canAddAnother={candidates.length > 0} onAddAnother={() => setPick('new')} settings={settings} onSave={onSave} onDelete={onDelete} onClose={onClose} />;
}

function CellForm({
  cal,
  slot,
  date,
  anchor,
  existing,
  siblings,
  canAddAnother,
  onAddAnother,
  settings,
  onSave,
  onDelete,
  onClose,
}: {
  cal: Calendar;
  slot: string;
  date: string;
  anchor: DOMRect;
  existing?: UiEvent;
  siblings: UiEvent[];
  canAddAnother: boolean;
  onAddAnother: () => void;
  settings: SchoolSettings;
  onSave: (e: UiEvent, applyToSiblings: boolean) => Promise<void>;
  onDelete?: (e: UiEvent, applyToSiblings: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const ex = existing;
  const [applySiblings, setApplySiblings] = useState(true);
  const [title, setTitle] = useState(ex?.title ?? '');
  const [kind, setKind] = useState<Kind>(ex?.kind ?? 'practice');
  const [allDay, setAllDay] = useState(ex ? !ex.timeStart : false);
  const [timeStart, setTimeStart] = useState(ex?.timeStart ?? '');
  const [timeEnd, setTimeEnd] = useState(ex?.timeEnd ?? '');
  const [startDate, setStartDate] = useState(ex?.date ?? date);
  const [endDate, setEndDate] = useState(ex?.endDate ?? '');
  const [place, setPlace] = useState(ex?.place ?? '');
  const [note, setNote] = useState(ex?.note ?? '');
  const [draft, setDraft] = useState(ex?.draft ?? false);
  const [slots, setSlots] = useState<string[]>(ex?.slots ?? [slot]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 320));
  const top = Math.min(anchor.bottom + window.scrollY + 2, window.scrollY + window.innerHeight - 420);

  const save = async () => {
    if (!title.trim()) return onClose();
    setBusy(true);
    setErr(undefined);
    try {
      const ad = allDay || ALLDAY.has(kind);
      const ts = ad ? undefined : timeStart || undefined;
      const te = ad || !ts ? undefined : timeEnd || addMinutes(ts, settings.defaultDurationMin);
      const ps = slots.length ? slots : [slot];
      const ed = endDate && endDate > startDate ? endDate : undefined;
      const e: UiEvent = {
        ...(ex ?? { uid: newUid(cal.id, { slots: ps, date: startDate, kind }), calendarId: cal.id, draft: false }),
        title: title.trim(),
        kind,
        timeStart: ts,
        timeEnd: te,
        date: startDate,
        endDate: ed,
        place: place.trim() || undefined,
        note: note.trim() || undefined,
        slots: ps,
        draft,
      };
      await onSave(e, applySiblings && siblings.length > 0);
      onClose();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKind = (k: Kind) => {
    setKind(k);
    if (ALLDAY.has(k)) setAllDay(true);
  };

  return (
    <div
      className="editor"
      style={{ left, top }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
          e.preventDefault();
          save();
        }
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="form">
        <div className="hint">
          {cal.name}
          {cal.slots.length > 1 ? ` ${slot}` : ''}
          {ex?.endDate ? `・${md(ex.date)}〜${md(ex.endDate)} の予定を編集` : `・${md(date)}（${WEEKDAYS[weekday(date)]}）`}
        </div>
        <input ref={first} id="ed-title" placeholder="内容（例: 練習 バス出発）" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="row2">
          <label>
            日付
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            終了日（泊まり・大会など）
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <div className="row2">
          <select value={kind} onChange={(e) => onKind(e.target.value as Kind)}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="row">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            終日
          </label>
        </div>
        {!allDay && (
          <div className="row2">
            <label>
              開始
              <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
            </label>
            <label>
              終了（空なら {settings.defaultDurationMin / 60} 時間後）
              <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
            </label>
          </div>
        )}
        <input placeholder="場所" value={place} onChange={(e) => setPlace(e.target.value)} />
        <input placeholder="備考" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="row">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          下書き（仮の予定。先生だけに見え、リンク・ICS・PDF には出ない）
        </label>
        {cal.slots.length > 1 && <SlotPick slots={cal.slots} value={slots} onChange={setSlots} title="班（複数を選ぶと横につながった 1 マスになり、配信では各班のカレンダーに入ります）" />}
        {siblings.length > 0 && (
          <label className="row">
            <input type="checkbox" checked={applySiblings} onChange={(e) => setApplySiblings(e.target.checked)} />
            隣の班（{siblings.flatMap((s) => s.slots).join('・')}）の同じ予定も一緒に直す
          </label>
        )}
        {canAddAnother && ex && (
          <button className="ghost" style={{ justifySelf: 'start', padding: 0, color: 'var(--ink)' }} onClick={onAddAnother}>
            ＋ この日に別の予定を追加
          </button>
        )}
        {err && <div className="error">{err}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="primary" onClick={save} disabled={busy || !title.trim()}>
            保存
          </button>
          {ex && onDelete && (
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete(ex, applySiblings && siblings.length > 0);
                  onClose();
                } catch (x) {
                  setErr((x as Error).message);
                  setBusy(false);
                }
              }}
            >
              削除
            </button>
          )}
          <span className="spacer" />
          {endDate && endDate > startDate && <span className="hint">{spanDays({ ...(ex ?? ({} as UiEvent)), date: startDate, endDate })} 日間</span>}
          <button className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
