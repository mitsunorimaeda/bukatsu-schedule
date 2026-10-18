import { nationalHolidayName } from '@bukatsu/core/browser';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAYS, covers, datesBetween, dayIndex, md, rowCells, spanPart, weekday, type Calendar, type UiEvent } from '../model';

/* 用紙サイズ（96dpi の px）。A4 横 297×210mm など */
export const PAPERS: Record<string, { w: number; h: number }> = { 'A4 横': { w: 1123, h: 794 }, 'A4 縦': { w: 794, h: 1123 }, 'A3 横': { w: 1587, h: 1123 } };
export type Layout = '月間表' | '週間' | '一覧';
export const LAYOUTS: Layout[] = ['月間表', '週間', '一覧'];

/** PDF の見た目の調整。fit は月間表で 1 か月を 1 枚に（文字と余白を自動で縮める） */
export interface PdfOptions {
  fit: boolean;
  autoWidth: boolean;
  inlineTime: boolean;
  hidePlace: boolean;
  hideCont: boolean;
}
export const DEFAULT_PDF_OPTIONS: PdfOptions = { fit: false, autoWidth: true, inlineTime: false, hidePlace: false, hideCont: false };
const OPT_KEY = 'bukatsu:pdf-options';
/** 前回の調整（この端末だけ） */
export function loadPdfOptions(): PdfOptions {
  try {
    return { ...DEFAULT_PDF_OPTIONS, ...(JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}') as Partial<PdfOptions>) };
  } catch {
    return DEFAULT_PDF_OPTIONS;
  }
}
export function savePdfOptions(o: PdfOptions) {
  try {
    localStorage.setItem(OPT_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/** 縮める段階。文字は 76%（印刷で読める下限の目安）まで、余白と行の最小の高さは 30% まで */
const FIT_STEPS = 12;
const FIT_MIN_FONT = 0.76;
const FIT_MIN_PAD = 0.3;
const fitScale = (i: number) => ({ k: 1 - ((1 - FIT_MIN_FONT) * i) / FIT_STEPS, kp: 1 - ((1 - FIT_MIN_PAD) * i) / FIT_STEPS });

export function PdfOptionsPicker({ layout, value, onChange }: { layout: Layout; value: PdfOptions; onChange: (o: PdfOptions) => void }) {
  if (layout === '一覧') return null;
  const box = (key: keyof PdfOptions, label: string, title?: string) => (
    <label title={title}>
      <input type="checkbox" checked={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="pdfopts">
      {layout === '月間表' && box('fit', '1か月を1枚に収める', '入りきらないときは文字・余白・行の高さを自動で縮めます。下限まで縮めても入らない月は 2 枚に分けます')}
      {box('autoWidth', '列の幅を中身に合わせる', '予定の多い列を広く、少ない列を狭くします')}
      {box('inlineTime', '時刻を内容と同じ行に')}
      {box('hidePlace', '場所を省く')}
      {box('hideCont', '「〜10/22」「2日目」を省く', '数日続く予定の続きの表示を省きます')}
    </div>
  );
}

export interface PdfCal {
  cal: Calendar;
  slots: string[];
  events: UiEvent[];
}

function fmtRange(from: string, to: string) {
  const f = (s: string) => `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
  return `${f(from)}〜${f(to)}`;
}
function estimateRowH(cals: PdfCal[], d: string, base: number, o: PdfOptions) {
  let lines = 1;
  for (const c of cals)
    for (const cell of rowCells(d, c.slots, c.events)) {
      let n = 0;
      for (const e of cell.events) {
        const timed = !!(e.timeStart || e.timeEnd);
        n += (timed && !o.inlineTime ? 1 : 0) + Math.ceil((e.title.length + (timed && o.inlineTime ? 6 : 0) + (e.endDate && !o.hideCont ? 6 : 0)) / 9) + (e.place && !o.hidePlace ? 1 : 0);
      }
      lines = Math.max(lines, n);
    }
  return Math.max(base, lines * 13 + 8);
}
/** 列の幅（px）。予定の文字数の平方根に比例させ、最小は均等幅の 45% */
function columnWidths(cals: PdfCal[], days: string[], o: PdfOptions, totalPx: number): number[] | undefined {
  if (!o.autoWidth) return undefined;
  const n = cals.reduce((a, c) => a + c.slots.length, 0);
  if (n < 2) return undefined;
  const w: number[] = Array(n).fill(0);
  let start = 0;
  for (const c of cals) {
    for (const d of days) {
      let k = start;
      for (const cell of rowCells(d, c.slots, c.events)) {
        const len = cell.events.reduce((a, e) => a + e.title.length + (e.timeStart ? 6 : 0) + (e.place && !o.hidePlace ? e.place.length : 0), 0);
        for (let j = 0; j < cell.span; j++) w[k + j] += len / cell.span;
        k += cell.span;
      }
    }
    start += c.slots.length;
  }
  const soft = w.map((x) => Math.sqrt(x));
  const sum = soft.reduce((a, b) => a + b, 0);
  if (!sum) return undefined;
  const min = (totalPx / n) * 0.45;
  const raw = soft.map((x) => (x / sum) * totalPx);
  const low = raw.map((x) => x < min);
  const restSum = raw.reduce((a, x, i) => a + (low[i] ? 0 : x), 0);
  if (!restSum) return undefined;
  const fixed = low.filter(Boolean).length * min;
  return raw.map((x, i) => (low[i] ? min : (x / restSum) * (totalPx - fixed)));
}
function chunkByHeight(days: string[], availH: number, cals: PdfCal[], base: number, o: PdfOptions) {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  for (const d of days) {
    const hh = estimateRowH(cals, d, base, o);
    if (cur.length && used + hh > availH) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(d);
    used += hh;
    if (weekday(d) === 0 && used > availH * 0.8) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function DayCell({ d, showMonth }: { d: string; showMonth: boolean }) {
  const hol = nationalHolidayName(d);
  return (
    <td className="d">
      {showMonth && <span className="mon">{Number(d.slice(5, 7))}月</span>}
      <b>{Number(d.slice(8, 10))}</b>
      <span>{WEEKDAYS[weekday(d)]}</span>
      {hol && <span className="hol">{hol}</span>}
    </td>
  );
}
function CellText({ e, d, o }: { e: UiEvent; d: string; o: PdfOptions }) {
  const p = spanPart(e, d);
  const t = p === 'single' && e.timeStart ? `${e.timeStart}${e.timeEnd ? '〜' + e.timeEnd : ''}` : p === 'start' && e.timeStart ? `${e.timeStart}〜` : p === 'end' && e.timeEnd ? `〜${e.timeEnd}` : '';
  return (
    <div className={`ev k-${e.kind}`}>
      {t && <span className="t">{t}</span>}
      {e.title}
      {!o.hideCont && p === 'start' && <span className="cont">（〜{md(e.endDate!)}）</span>}
      {!o.hideCont && p === 'mid' && <span className="cont">（{dayIndex(e, d)}日目）</span>}
      {!o.hideCont && p === 'end' && <span className="cont">（最終日）</span>}
      {e.place && !o.hidePlace && p !== 'mid' && <span className="pl">＠{e.place}</span>}
    </div>
  );
}

const NO_PARTS = new Map<string, number>();
const MAX_PARTS = 6;
/** 日を、見積もった高さがだいたい等しい n 個に分ける（なるべく日曜の後で切る） */
function splitEven(days: string[], n: number, cals: PdfCal[], base: number, o: PdfOptions): string[][] {
  if (n <= 1) return [days];
  const hs = days.map((d) => estimateRowH(cals, d, base, o));
  const total = hs.reduce((a, b) => a + b, 0);
  const out: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  days.forEach((d, i) => {
    cur.push(d);
    used += hs[i];
    const target = (total * (out.length + 1)) / n;
    const left = days.length - i - 1;
    if (out.length < n - 1 && left > 0 && (used >= target || (weekday(d) === 0 && used >= target * 0.85))) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

export function PdfPages({ wsName, cals, from, to, layout, paper, versionsNote, options }: { wsName: string; cals: PdfCal[]; from: string; to: string; layout: Layout; paper: string; versionsNote: string; options?: PdfOptions }) {
  const o = options ?? DEFAULT_PDF_OPTIONS;
  const P = PAPERS[paper] ?? PAPERS['A4 横'];
  const fitMonth = layout === '月間表' && o.fit;
  // 1 枚に入りきらなかった月 → 何枚に分けるか（入力が変わったら捨てる）
  const sig = useMemo(() => ({}), [cals, from, to, layout, paper, o.fit, o.autoWidth, o.inlineTime, o.hidePlace, o.hideCont]);
  const [split, setSplit] = useState<{ sig: object | null; parts: Map<string, number> }>({ sig: null, parts: NO_PARTS });
  const parts = split.sig === sig ? split.parts : NO_PARTS;
  const onMonthFit = (m: string, n: number, ok: boolean) => {
    if (ok || n >= MAX_PARTS) return;
    setSplit((prev) => {
      const cur = prev.sig === sig ? prev.parts : NO_PARTS;
      if ((cur.get(m) ?? 1) !== n) return prev;
      return { sig, parts: new Map([...cur, [m, n + 1]]) };
    });
  };
  const days = datesBetween(from, to);
  const cols = cals.flatMap((c) => c.slots.map((s) => ({ c, s })));
  const base = layout === '一覧' ? 18 : P.h > P.w ? 26 : 24;
  const availH = P.h - 34 * 2 - 110;
  let chunks: string[][];
  if (layout === '週間') {
    chunks = [];
    let cur: string[] = [];
    for (const d of days) {
      cur.push(d);
      if (weekday(d) === 0) {
        chunks.push(cur);
        cur = [];
      }
    }
    if (cur.length) chunks.push(cur);
  } else if (layout === '一覧') {
    chunks = [];
    let cur: string[] = [];
    let used = 0;
    for (const d of days) {
      const n = Math.max(1, cals.reduce((a, c) => a + c.events.filter((e) => covers(e, d)).length, 0));
      if (cur.length && used + n * base > availH) {
        chunks.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(d);
      used += n * base;
    }
    if (cur.length) chunks.push(cur);
  } else if (fitMonth) {
    chunks = [];
    const byMonth = new Map<string, string[]>();
    for (const d of days) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
    for (const [, ds] of byMonth) chunks.push(...splitEven(ds, parts.get(ds[0].slice(0, 7)) ?? 1, cals, base, o));
  } else chunks = chunkByHeight(days, availH, cals, base, o);
  const widths = layout === '一覧' ? undefined : columnWidths(cals, days, o, P.w - 38 * 2 - 62);

  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {fitMonth && parts.size > 0 && (
        <p className="pdfnote">
          {[...parts].map(([m, n]) => `${Number(m.slice(5, 7))}月（${n} 枚）`).join('・')}は、文字を下限まで縮めても 1 枚に入らなかったので分けました。出すカレンダーや班をしぼるか、「時刻を内容と同じ行に」「場所を省く」などを試してください。
        </p>
      )}
      {chunks.map((ds, pi) => {
        const m = fitMonth ? ds[0].slice(0, 7) : undefined;
        const n = m ? (parts.get(m) ?? 1) : 1;
        return (
        <PageWrap key={pi} w={P.w} h={P.h} fit={fitMonth} className={o.inlineTime ? 'o-inline' : undefined} onFit={m ? (ok) => onMonthFit(m, n, ok) : undefined}>
          <h4>{wsName}　予定表</h4>
          <div className="sub">
            <span>
              {fmtRange(from, to)}　{cals.map((c) => c.cal.name).join('・')}
            </span>
            <span>{layout}</span>
          </div>
          <div className="body">
          {layout === '一覧' ? (
            <table>
              <colgroup>
                <col className="daycol" />
                <col style={{ width: '9em' }} />
                <col style={{ width: '7em' }} />
                <col style={{ width: '8em' }} />
                <col />
                <col style={{ width: '8em' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>日</th>
                  <th>カレンダー</th>
                  <th>班</th>
                  <th>時刻</th>
                  <th>内容</th>
                  <th>場所</th>
                </tr>
              </thead>
              <tbody>
                {ds.flatMap((d) => {
                  let first = true;
                  return cals.flatMap((c) =>
                    c.events
                      .filter((e) => covers(e, d))
                      .map((e) => {
                        const p = spanPart(e, d);
                        const row = (
                          <tr key={`${d}-${e.uid}`} className={weekday(d) === 0 || nationalHolidayName(d) ? 'sun' : weekday(d) === 6 ? 'sat' : ''}>
                            {first ? <DayCell d={d} showMonth={d.endsWith('-01') || d === ds[0]} /> : <td className="d" />}
                            <td>{c.cal.name}</td>
                            <td>{e.slots.length === c.cal.slots.length && c.cal.slots.length > 1 ? '全班' : e.slots.join('・')}</td>
                            <td>{e.timeStart ? `${e.timeStart}${e.timeEnd ? '〜' + e.timeEnd : ''}` : '終日'}</td>
                            <td>
                              {e.title}
                              {p === 'start' ? `（〜${md(e.endDate!)}）` : p === 'mid' ? `（${dayIndex(e, d)}日目）` : p === 'end' ? '（最終日）' : ''}
                            </td>
                            <td>{e.place ?? ''}</td>
                          </tr>
                        );
                        first = false;
                        return row;
                      }),
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table>
              <colgroup>
                <col className="daycol" />
                {cols.map((_, i) => (
                  <col key={i} style={widths ? { width: widths[i] } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>日</th>
                  {cals.map((c) => (
                    <th key={c.cal.id} colSpan={c.slots.length} className="calhead" style={{ ['--c' as string]: c.cal.color }}>
                      {c.cal.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  {cols.map(({ c, s }) => (
                    <th key={`${c.cal.id}|${s}`} className="slothead">
                      {c.cal.slots.length > 1 ? s : '　'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ds.map((d, i) => (
                  <tr key={d} className={weekday(d) === 0 || nationalHolidayName(d) ? 'sun' : weekday(d) === 6 ? 'sat' : ''} style={{ height: `calc(${base}px * var(--kp, 1))` }}>
                    <DayCell d={d} showMonth={i === 0 || d.endsWith('-01')} />
                    {cals.map((c) =>
                      rowCells(d, c.slots, c.events).map((cell) => (
                        <td key={`${c.cal.id}|${cell.slot}`} colSpan={cell.span > 1 ? cell.span : undefined} className={cell.span > 1 ? 'shared' : cell.events.length ? '' : 'empty'}>
                          {cell.events.map((e) => (
                            <CellText key={e.uid} e={e} d={d} o={o} />
                          ))}
                        </td>
                      )),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
          <div className="foot">
            <span>版: {versionsNote}</span>
            <span>
              作成 {today}　{pi + 1} / {chunks.length} ページ　{paper}
            </span>
          </div>
        </PageWrap>
        );
      })}
    </>
  );
}

/**
 * 入れ物の幅に合わせてページを縮小する（見た目だけ。印刷では実寸）。
 * fit なら、表が用紙に入るまで文字・余白・行の高さを段階的に縮め、入ったかを onFit で返す
 */
function PageWrap({ w, h, fit, className, onFit, children }: { w: number; h: number; fit?: boolean; className?: string; onFit?: (ok: boolean) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      const avail = el.parentElement?.clientWidth ?? w;
      const s = Math.min(1, avail / w);
      el.style.width = `${w * s}px`;
      el.style.height = `${h * s}px`;
      (el.firstElementChild as HTMLElement).style.transform = `scale(${s})`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [w, h]);
  // 中身が変わるたびに測り直す（測るのは変形前の大きさなので、縮小表示でも印刷と同じ結果）
  useLayoutEffect(() => {
    const page = pageRef.current;
    const body = page?.querySelector<HTMLElement>('.body');
    if (!page || !body) return;
    const apply = (i: number) => {
      const { k, kp } = fitScale(i);
      page.style.setProperty('--k', String(k));
      page.style.setProperty('--kp', String(kp));
    };
    const over = () => body.scrollHeight > body.clientHeight + 1;
    const run = () => {
      let i = 0;
      apply(0);
      if (!fit) return;
      while (over() && i < FIT_STEPS) apply(++i);
      onFitRef.current?.(!over());
    };
    run();
    let alive = true;
    (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => alive && run()).catch(() => undefined);
    return () => {
      alive = false;
    };
  });
  return (
    <div className="pagewrap" ref={ref}>
      <div className={`page${className ? ` ${className}` : ''}`} ref={pageRef} style={{ width: w, height: h }}>
        {children}
      </div>
    </div>
  );
}
