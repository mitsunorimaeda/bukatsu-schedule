import { nationalHolidayName } from '@bukatsu/core/browser';
import { useLayoutEffect, useRef } from 'react';
import { WEEKDAYS, covers, datesBetween, dayIndex, md, rowCells, spanPart, weekday, type Calendar, type UiEvent } from '../model';

/* 用紙サイズ（96dpi の px）。A4 横 297×210mm など */
export const PAPERS: Record<string, { w: number; h: number }> = { 'A4 横': { w: 1123, h: 794 }, 'A4 縦': { w: 794, h: 1123 }, 'A3 横': { w: 1587, h: 1123 } };
export type Layout = '月間表' | '週間' | '一覧';
export const LAYOUTS: Layout[] = ['月間表', '週間', '一覧'];

export interface PdfCal {
  cal: Calendar;
  slots: string[];
  events: UiEvent[];
}

function fmtRange(from: string, to: string) {
  const f = (s: string) => `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
  return `${f(from)}〜${f(to)}`;
}
function estimateRowH(cals: PdfCal[], d: string, base: number) {
  let lines = 1;
  for (const c of cals)
    for (const cell of rowCells(d, c.slots, c.events)) {
      let n = 0;
      for (const e of cell.events) n += (e.timeStart || e.timeEnd ? 1 : 0) + Math.ceil((e.title.length + (e.endDate ? 6 : 0)) / 9) + (e.place ? 1 : 0);
      lines = Math.max(lines, n);
    }
  return Math.max(base, lines * 13 + 8);
}
function chunkByHeight(days: string[], availH: number, cals: PdfCal[], base: number) {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  for (const d of days) {
    const hh = estimateRowH(cals, d, base);
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
function CellText({ e, d }: { e: UiEvent; d: string }) {
  const p = spanPart(e, d);
  const t = p === 'single' && e.timeStart ? `${e.timeStart}${e.timeEnd ? '〜' + e.timeEnd : ''}` : p === 'start' && e.timeStart ? `${e.timeStart}〜` : p === 'end' && e.timeEnd ? `〜${e.timeEnd}` : '';
  return (
    <div className={`ev k-${e.kind}`}>
      {t && <span className="t">{t}</span>}
      {e.title}
      {p === 'start' && <span className="cont">（〜{md(e.endDate!)}）</span>}
      {p === 'mid' && <span className="cont">（{dayIndex(e, d)}日目）</span>}
      {p === 'end' && <span className="cont">（最終日）</span>}
      {e.place && p !== 'mid' && <span className="pl">＠{e.place}</span>}
    </div>
  );
}

export function PdfPages({ wsName, cals, from, to, layout, paper, versionsNote }: { wsName: string; cals: PdfCal[]; from: string; to: string; layout: Layout; paper: string; versionsNote: string }) {
  const P = PAPERS[paper] ?? PAPERS['A4 横'];
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
  } else chunks = chunkByHeight(days, availH, cals, base);

  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {chunks.map((ds, pi) => (
        <PageWrap key={pi} w={P.w} h={P.h}>
          <h4>{wsName}　予定表</h4>
          <div className="sub">
            <span>
              {fmtRange(from, to)}　{cals.map((c) => c.cal.name).join('・')}
            </span>
            <span>{layout}</span>
          </div>
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
                  <col key={i} />
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
                  <tr key={d} className={weekday(d) === 0 || nationalHolidayName(d) ? 'sun' : weekday(d) === 6 ? 'sat' : ''} style={{ height: base }}>
                    <DayCell d={d} showMonth={i === 0 || d.endsWith('-01')} />
                    {cals.map((c) =>
                      rowCells(d, c.slots, c.events).map((cell) => (
                        <td key={`${c.cal.id}|${cell.slot}`} colSpan={cell.span > 1 ? cell.span : undefined} className={cell.span > 1 ? 'shared' : cell.events.length ? '' : 'empty'}>
                          {cell.events.map((e) => (
                            <CellText key={e.uid} e={e} d={d} />
                          ))}
                        </td>
                      )),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="foot">
            <span>版: {versionsNote}</span>
            <span>
              作成 {today}　{pi + 1} / {chunks.length} ページ　{paper}
            </span>
          </div>
        </PageWrap>
      ))}
    </>
  );
}

/** 入れ物の幅に合わせてページを縮小する */
function PageWrap({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const avail = el.parentElement?.clientWidth ?? w;
      const s = Math.min(1, avail / w);
      el.style.width = `${w * s}px`;
      el.style.height = `${h * s}px`;
      (el.firstElementChild as HTMLElement).style.transform = `scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div className="pagewrap" ref={ref}>
      <div className="page" style={{ width: w, height: h }}>
        {children}
      </div>
    </div>
  );
}
