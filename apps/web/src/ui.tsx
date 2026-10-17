import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/* 小さな共通部品: トースト、班の選択、パネルの枠 */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function useToast() {
  return useContext(ToastCtx);
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2400);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export function copyText(text: string, toast: (m: string) => void) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast('コピーしました'))
    .catch(() => toast('コピーできませんでした。URL を選択してコピーしてください'));
}

export function Panel({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`panel${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
      <button className="close ghost" onClick={onClose} aria-label="閉じる">
        ✕
      </button>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** 班の選択（見出し + 全部/なし + 等幅の格子） */
export function SlotPick({ slots, value, onChange, title }: { slots: string[]; value: string[]; onChange: (v: string[]) => void; title: string }) {
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="slotpick">
      <div className="head">
        <span>{title}</span>
        <span className="acts">
          <button type="button" onClick={() => onChange([...slots])}>
            全部
          </button>
          <button type="button" onClick={() => onChange([])}>
            なし
          </button>
        </span>
      </div>
      <div className="grid">
        {slots.map((s) => (
          <label key={s} className={value.includes(s) ? 'sel' : ''}>
            <input type="checkbox" checked={value.includes(s)} onChange={() => toggle(s)} />
            <span>{s}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
