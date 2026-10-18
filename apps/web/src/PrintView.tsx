import { useEffect, useState } from 'react';
import { loadByToken, loadWorkspace } from './api';
import { publicEvents, type Workspace } from './model';
import { PAPERS, PdfPages, type Layout, type PdfCal, type PdfOptions } from './panels/PdfPages';

/** 共有・出力の「PDF を保存」から開く印刷専用ページ。プレビューと同じ描画を用紙の実寸で並べ、ブラウザの印刷（PDF に保存）に渡す */
export interface PrintJob {
  wsId?: string;
  token?: string;
  sel: string[];
  slotSel: Record<string, string[]>;
  from: string;
  to: string;
  layout: Layout;
  paper: string;
  options?: PdfOptions;
}

export function savePrintJob(job: PrintJob): string {
  const key = `print-${Date.now().toString(36)}`;
  try {
    localStorage.setItem(`bukatsu:${key}`, JSON.stringify(job));
  } catch {
    /* ignore */
  }
  return key;
}

export function PrintView({ jobKey }: { jobKey: string }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let j: PrintJob | null = null;
    try {
      j = JSON.parse(localStorage.getItem(`bukatsu:${jobKey}`) ?? 'null');
    } catch {
      /* ignore */
    }
    if (!j) {
      setErr('印刷の内容が見つかりません。共有・出力の画面からもう一度開いてください。');
      return;
    }
    setJob(j);
    (j.token ? loadByToken(j.token) : loadWorkspace(j.wsId!)).then(setWs).catch((e) => setErr(e.message));
  }, [jobKey]);
  useEffect(() => {
    if (!ws || !job) return;
    // フォントと描画が落ち着いてから印刷ダイアログを出す
    const t = setTimeout(() => {
      (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => window.print()).catch(() => window.print());
    }, 600);
    return () => clearTimeout(t);
  }, [ws, job]);
  if (err) return <div style={{ padding: 20 }}>{err}</div>;
  if (!ws || !job) return <div style={{ padding: 20 }}>準備中…</div>;
  const P = PAPERS[job.paper] ?? PAPERS['A4 横'];
  const cals: PdfCal[] = ws.calendars
    .filter((c) => job.sel.includes(c.id))
    .map((c) => ({ cal: c, slots: job.slotSel[c.id] ? c.slots.filter((s) => job.slotSel[c.id].includes(s)) : c.slots, events: publicEvents(c) }))
    .filter((c) => c.slots.length);
  const versionsNote = cals.map((c) => (c.cal.publishedAt ? `${c.cal.name}: 公開 ${c.cal.publishedAt.slice(0, 10)}` : '')).filter(Boolean).join('　');
  const mm = (px: number) => Math.round((px / 96) * 25.4);
  return (
    <div className="printview">
      <style>{`
        @page { size: ${mm(P.w)}mm ${mm(P.h)}mm; margin: 0; }
        .printview .bar { position: sticky; top: 0; background: var(--paper); border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; gap: 12px; align-items: center; }
        .printview .pages { padding: 16px; background: var(--bg); }
        @media print {
          body { background: #fff; }
          .printview .bar { display: none; }
          .printview .pages { padding: 0; background: #fff; }
          .printview .pagewrap { width: ${P.w}px !important; height: ${P.h}px !important; margin: 0 !important; overflow: visible; page-break-after: always; break-after: page; }
          .printview .pagewrap:last-child { page-break-after: auto; break-after: auto; }
          .printview .page { transform: none !important; box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="bar">
        <b>PDF を保存</b>
        <span className="hint">印刷ダイアログで送信先を「PDF に保存」にしてください（用紙 {job.paper}、余白なし、背景色あり）。ダイアログが出ないときは Cmd+P / Ctrl+P。</span>
        <span className="spacer" />
        <button className="primary" onClick={() => window.print()}>
          もう一度ダイアログを開く
        </button>
        <button onClick={() => window.close()}>閉じる</button>
      </div>
      <div className="pages">
        <PdfPages wsName={ws.name} cals={cals} from={job.from} to={job.to} layout={job.layout} paper={job.paper} versionsNote={versionsNote} options={job.options} />
      </div>
    </div>
  );
}
