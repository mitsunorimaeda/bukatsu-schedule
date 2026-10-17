import { useLayoutEffect, useState } from 'react';

const STEPS = [
  { sel: '.side .cal', title: 'カレンダー', text: '部活・学校行事・外部予定などの単位です。チェックで表示を切り替え。⚙ で名前・色・班を変えられます。' },
  { sel: 'td.cell', title: 'マスをクリックして書く', text: '日付 × 班のマスをクリックすると、その場で予定を書けます。時刻・終日・日をまたぐ予定・複数の班にも対応。' },
  { sel: '[data-tour="import"]', title: 'いつもの PDF を読ませる', text: 'Excel で作った PDF や写真をドロップすると表に起こします。確認してから反映するので安心です。' },
  { sel: '.cal .gear', title: '版と変更点', text: '取り込むたびに「版」として残り、前の版との違いを色で確認できます。変更点の連絡文もコピーできます。' },
  { sel: '[data-tour="share"]', title: '共有・出力', text: '見せたいカレンダーと班、期間を選んで、閲覧リンク・ICS・PDF に。保護者には班ごとのリンクを渡せます。' },
  { sel: '[data-tour="members"]', title: 'メンバー', text: '顧問や先生を招待して、「このカレンダーのこの班だけ編集できる」を決めます。見るだけの人はリンクで足ります。' },
];

export function Tour({ onEnd }: { onEnd: () => void }) {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<{ ring: DOMRect; left: number; top: number } | null>(null);
  const st = STEPS[step];
  useLayoutEffect(() => {
    const el = document.querySelector(st.sel) as HTMLElement | null;
    if (!el) {
      if (step < STEPS.length - 1) setStep(step + 1);
      else onEnd();
      return;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    let left = r.right + 14;
    let top = r.top;
    if (left + 310 > window.innerWidth) left = Math.max(12, r.left - 314);
    if (left < 12) left = 12;
    if (top + 170 > window.innerHeight) top = Math.max(12, window.innerHeight - 180);
    setPos({ ring: r, left, top });
  }, [step, st.sel, onEnd]);
  if (!pos) return null;
  return (
    <>
      <div className="tour-ring" style={{ left: pos.ring.left - 6, top: pos.ring.top - 6, width: pos.ring.width + 12, height: pos.ring.height + 12 }} />
      <div className="tour-box" style={{ left: pos.left, top: pos.top }}>
        <div className="step">
          {step + 1} / {STEPS.length}
        </div>
        <h4>{st.title}</h4>
        <p>{st.text}</p>
        <div className="acts">
          {step > 0 && <button onClick={() => setStep(step - 1)}>戻る</button>}
          <button className="primary" onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : onEnd())}>
            {step === STEPS.length - 1 ? 'はじめる' : '次へ'}
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={onEnd}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
