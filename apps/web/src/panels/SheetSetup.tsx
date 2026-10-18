import { useState } from 'react';
import { guessMapping, normalizeSheetUrl, parseCsv, parseSheetDate, currentFiscalYear } from '@bukatsu/core/browser';
import type { SheetMapping, SheetSource } from '@bukatsu/core/browser';
import { fetchSheetCsv } from '../api';

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const colName = (i: number) => COLS[i] ?? `列${i + 1}`;

/**
 * Google シート / CSV のつなぎ方: URL → 先頭の数行を見ながら列を選ぶ。
 * 選んだ列だけが保存の対象。他の列（選手名など）は取り込まない。
 */
export function SheetSetup({ schoolId, calendarId, value, onChange }: { schoolId: string; calendarId?: string; value: SheetSource | null; onChange: (v: SheetSource | null) => void }) {
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
  const pick = (key: keyof SheetMapping, label: string, required = false) => (
    <label key={key}>
      {label}
      <select value={mapping[key] == null ? '' : String(mapping[key])} onChange={(e) => emit({ ...mapping, [key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
        <option value="">{required ? '選んでください' : '使わない'}</option>
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            {colName(i)}
            {rows && mapping.headerRows ? `: ${(rows[0]?.[i] ?? '').slice(0, 12)}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
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
          <div className="sheet-preview">
            <table>
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, i) => (
                    <th key={i} className={[mapping.date, mapping.time, mapping.title, mapping.place, mapping.slot, mapping.endDate].includes(i) ? 'on' : ''}>
                      {colName(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, ri) => (
                  <tr key={ri} className={ri < (mapping.headerRows ?? 1) ? 'head' : ''}>
                    {Array.from({ length: width }, (_, i) => (
                      <td key={i} className={[mapping.date, mapping.time, mapping.title, mapping.place, mapping.slot, mapping.endDate].includes(i) ? 'on' : ''}>
                        {(r[i] ?? '').slice(0, 20)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">全 {rows.length} 行。色の付いた列だけを使います。それ以外の列（選手名など）は読み込んでも保存しません。</p>
          <div className="row2">
            {pick('date', '日付の列', true)}
            {pick('title', '内容の列', true)}
          </div>
          <div className="row2">
            {pick('time', '時刻の列（内容に書かれていれば不要）')}
            {pick('place', '場所の列')}
          </div>
          <div className="row2">
            {pick('slot', '班の列（無ければ全班に入れる）')}
            {pick('endDate', '終了日の列')}
          </div>
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
