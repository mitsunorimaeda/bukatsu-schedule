import { useState } from 'react';
import { guessMapping, normalizeSheetUrl, parseCsv, parseSheetDate, currentFiscalYear } from '@bukatsu/core/browser';
import type { SheetMapping, SheetSource } from '@bukatsu/core/browser';
import { fetchSheetCsv } from '../api';

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const colName = (i: number) => COLS[i] ?? `列${i + 1}`;

type RoleKey = 'date' | 'title' | 'time' | 'place' | 'slot' | 'endDate';
/** 列の役割。見出しのプルダウンで選ぶ。色は styles.css の .r-xxx と対応 */
const ROLES: { key: RoleKey; label: string; desc: string; required?: boolean }[] = [
  { key: 'date', label: '日付', desc: 'いつの予定か（10/1、2026/10/1、10月1日 など）', required: true },
  { key: 'title', label: '内容', desc: '何をするか（練習・試合・休み など）。表のマスに出る文字になります。班ごとに列が分かれている表なら、その列を全部「内容」にします', required: true },
  { key: 'time', label: '時刻', desc: '「9:00〜12:00」など。内容の中に書いてあれば不要' },
  { key: 'place', label: '場所', desc: 'グラウンド・体育館 など' },
  { key: 'slot', label: '班', desc: '1 行ごとに班名（トップ・1年 など）が書いてある列。無ければ全班に入ります。班ごとに列が分かれている表では使いません' },
  { key: 'endDate', label: '終了日', desc: '合宿や遠征など、数日続く予定の最終日' },
];

/**
 * Google シート / CSV のつなぎ方: URL → 先頭の数行を見ながら列を選ぶ。
 * 選んだ列だけが保存の対象。他の列（選手名など）は取り込まない。
 */
export function SheetSetup({ schoolId, calendarId, value, onChange, slots = [] }: { schoolId: string; calendarId?: string; value: SheetSource | null; onChange: (v: SheetSource | null) => void; /** カレンダーの班（班ごとの列の入れ先に使う） */ slots?: string[] }) {
  const [url, setUrl] = useState(value?.url ?? '');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Partial<SheetMapping>>(value?.mapping ?? { headerRows: 1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const [auto, setAuto] = useState<'apply' | 'pending' | 'off'>(value?.auto ?? 'apply');
  const emit = (m: Partial<SheetMapping>, u = url, a = auto) => {
    setMapping(m);
    const n = normalizeSheetUrl(u);
    if (n && m.date != null && m.title != null) {
      const changedUrl = value && value.csvUrl !== n.csvUrl;
      // 記録（lastSync など）は保つ。URL が変わったら指紋は捨てて次回に必ず取り込む
      onChange({ ...(value ?? {}), kind: 'sheet', url: u.trim(), csvUrl: n.csvUrl, mapping: { headerRows: 1, ...m, date: m.date, title: m.title }, auto: a, lastHash: changedUrl ? undefined : value?.lastHash });
    } else onChange(null);
  };
  const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  const load = async () => {
    setErr(undefined);
    const n = normalizeSheetUrl(url);
    if (!n) return setErr('https で始まる URL を貼ってください（Google シートの共有リンク、または CSV の URL）');
    setBusy(true);
    try {
      const csv = await fetchSheetCsv(schoolId, calendarId, n.csvUrl);
      const rs = parseCsv(csv);
      if (!rs.length) throw new Error('中身が空でした');
      setRows(rs);
      // 見出しから推測。すでに設定があればそれを優先
      const g = value?.mapping && value.url === url.trim() ? value.mapping : { headerRows: 1, ...guessMapping(rs[0]) };
      emit({ ...g, headerRows: g.headerRows ?? 1 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const width = rows ? Math.max(...rows.slice(0, 8).map((r) => r.length)) : 0;
  /** 内容の列（複数可）。titles があればそれ、無ければ title の 1 列 */
  const titleCols: { col: number; slot?: string }[] = mapping.titles?.length ? mapping.titles : mapping.title != null ? [{ col: mapping.title }] : [];
  const roleOf = (i: number): RoleKey | undefined => (titleCols.some((t) => t.col === i) ? 'title' : ROLES.find((r) => r.key !== 'title' && mapping[r.key] === i)?.key);
  const withTitles = (m: Partial<SheetMapping>, list: { col: number; slot?: string }[]): Partial<SheetMapping> => {
    const sorted = [...list].sort((a, b) => a.col - b.col);
    const out: Partial<SheetMapping> = { ...m, title: sorted[0]?.col, titles: sorted.length > 1 ? sorted : undefined };
    if (sorted.length === 0) delete out.title;
    if (!out.titles) delete out.titles;
    return out;
  };
  /** 列 i の役割を付け替える。内容は何列でも可（班ごとの列）。他の役割は 1 列だけ */
  const setRole = (i: number, key: RoleKey | '') => {
    let m: Partial<SheetMapping> = { ...mapping };
    for (const r of ROLES) if (r.key !== 'title' && m[r.key] === i) delete m[r.key];
    m = withTitles(m, titleCols.filter((t) => t.col !== i));
    if (key === 'title') m = withTitles(m, [...titleCols.filter((t) => t.col !== i), { col: i }]);
    else if (key) m[key] = i;
    emit(m);
  };
  const setTitleSlot = (i: number, slot: string) => emit(withTitles(mapping, titleCols.map((t) => (t.col === i ? { col: i, ...(slot ? { slot } : {}) } : t))));
  const headText = (i: number) => (rows && mapping.headerRows ? (rows[0]?.[i] ?? '').trim() : '');
  const wide = titleCols.length > 1;
  const slotLabel = (t: { col: number; slot?: string }) => (t.slot === '*' ? '全班' : t.slot ?? (headText(t.col) || '（見出しなし → 全班）'));
  const fy = mapping.fiscalYear ?? currentFiscalYear();
  const sample = rows && mapping.date != null ? rows.slice(mapping.headerRows ?? 1, (mapping.headerRows ?? 1) + 3).map((r) => parseSheetDate(r[mapping.date!] ?? '', fy) ?? '？') : [];

  return (
    <div className="form sheet-setup">
      <label>
        シートの URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…  または  https://…/xxx.csv" />
      </label>
      <p className="hint">Google シートは「共有」→「リンクを知っている全員が閲覧可」にするか、「ファイル → 共有 → ウェブに公開」で CSV を選んだ URL を貼ります。タブ（gid）付きの URL ならそのタブを読みます。</p>
      <div>
        <button onClick={load} disabled={busy || !url.trim()}>
          {busy ? '読み込み中…' : rows ? 'もう一度読み込む' : '読み込んで列を選ぶ'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      {rows && (
        <>
          <p className="hint" style={{ margin: 0 }}>
            各列の見出しにあるプルダウンで、その列が「何の列か」を選びます。色が付いた列だけを使い、「使わない」のままの列は読み込んでも保存しません。<b>選手名が書かれた列は「使わない」のままにしてください</b>（内容にすると名前も予定として保存・配信されます）。
          </p>
          <div className="sheet-preview">
            <table>
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, i) => {
                    const role = roleOf(i);
                    return (
                      <th key={i} className={role ? `r-${role}` : 'off'}>
                        <div className="colhead">
                          <b>{colName(i)}</b>
                          {headText(i) && <small title={headText(i)}>{headText(i).slice(0, 10)}</small>}
                        </div>
                        <select className="rolepick" value={role ?? ''} onChange={(e) => setRole(i, e.target.value as RoleKey | '')} title="この列は何の列か">
                          <option value="">使わない</option>
                          {ROLES.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.label}
                              {r.required ? '（必須）' : ''}
                            </option>
                          ))}
                        </select>
                        {role === 'title' && wide && (
                          <select className="rolepick slotpick" value={titleCols.find((t) => t.col === i)?.slot ?? ''} onChange={(e) => setTitleSlot(i, e.target.value)} title="この列の予定を入れる班">
                            <option value="">→ 班「{headText(i) || '全班'}」（見出しのまま）</option>
                            {slots.filter((x) => x && x !== headText(i)).map((x) => (
                              <option key={x} value={x}>
                                → 班「{x}」
                              </option>
                            ))}
                            <option value="*">→ 全班に入れる</option>
                          </select>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, ri) => (
                  <tr key={ri} className={ri < (mapping.headerRows ?? 1) ? 'head' : ''}>
                    {Array.from({ length: width }, (_, i) => {
                      const role = roleOf(i);
                      return (
                        <td key={i} className={role ? `r-${role}` : 'off'}>
                          {(r[i] ?? '').slice(0, 20)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="rolesum">
            {ROLES.map((r) => {
              const i = mapping[r.key];
              const missing = r.required && i == null;
              const colText = (c: number) => `${colName(c)} 列${headText(c) ? `「${headText(c).slice(0, 10)}」` : ''}`;
              const where = r.key === 'title' && wide ? titleCols.map((t) => `${colText(t.col)} → 班「${slotLabel(t)}」`).join('、') : i != null ? colText(i) : missing ? '未選択（必須）' : '使わない';
              return (
                <li key={r.key} className={i != null ? `r-${r.key}` : missing ? 'missing' : 'off'}>
                  <b>{r.label}</b>
                  <span className="where" style={wide && r.key === 'title' ? { whiteSpace: 'normal' } : undefined}>{where}</span>
                  <small>{r.key === 'slot' && wide ? '内容を複数列にしているので、班は列の見出しで決まります' : r.desc}</small>
                </li>
              );
            })}
          </ul>
          <p className="hint" style={{ margin: 0 }}>全 {rows.length} 行。</p>
          <div className="row2">
            <label>
              見出しの行数
              <select value={String(mapping.headerRows ?? 1)} onChange={(e) => emit({ ...mapping, headerRows: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              年が無い日付の年度
              <input type="number" value={fy} onChange={(e) => emit({ ...mapping, fiscalYear: Number(e.target.value) || undefined })} />
            </label>
          </div>
          {mapping.date != null && <p className="hint">日付の読み: {sample.join('、')}</p>}
        </>
      )}
      {(rows || value) && (
        <label>
          自動更新（1 時間ごとにシートを見に行き、変わっていたら）
          <select
            value={auto}
            onChange={(e) => {
              const a = e.target.value as 'apply' | 'pending' | 'off';
              setAuto(a);
              emit(mapping, url, a);
            }}
          >
            <option value="apply">そのまま反映する（シートが元データなので既定）</option>
            <option value="pending">確認待ちにして、先生が反映する</option>
            <option value="off">自動では見に行かない（「いま取り込む」だけ）</option>
          </select>
        </label>
      )}
      {value?.lastSync && (
        <p className="hint">
          最終確認 {fmtWhen(value.lastSync)}
          {value.lastChange ? `・最後に変わったのは ${fmtWhen(value.lastChange)}（${value.lastCount ?? '?'} 件）` : '・まだ自動更新での取り込みはありません'}
          {value.lastError ? <span style={{ color: 'var(--red)' }}>・前回のエラー: {value.lastError}</span> : ''}
        </p>
      )}
    </div>
  );
}
