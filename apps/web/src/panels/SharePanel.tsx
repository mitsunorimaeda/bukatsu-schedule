import { useEffect, useMemo, useState } from 'react';
import { createShareLink, icsUrl, listShareLinks, revokeShareLink, shareUrl, type ShareLink, type ShareScope } from '../api';
import { draftCount, md, publicEvents, todayYm, unpublishedChanges, type Workspace } from '../model';
import { Panel, SlotPick, copyText, useToast } from '../ui';
import { LAYOUTS, PAPERS, PdfOptionsPicker, PdfPages, loadPdfOptions, savePdfOptions, type Layout, type PdfCal, type PdfOptions } from './PdfPages';
import { savePrintJob } from '../PrintView';

type Tab = 'link' | 'ics' | 'pdf';

export function SharePanel({ ws, onClose, canManage, token }: { ws: Workspace; onClose: () => void; canManage: boolean; token?: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('link');
  const [sel, setSel] = useState<Set<string>>(() => new Set(ws.calendars.map((c) => c.id)));
  const [slotSel, setSlotSel] = useState<Record<string, string[]>>({});
  const ym = todayYm();
  const [from, setFrom] = useState(`${ym}-01`);
  const [to, setTo] = useState(() => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [label, setLabel] = useState('');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [err, setErr] = useState<string>();
  const [layout, setLayout] = useState<Layout>('月間表');
  const [paper, setPaper] = useState('A4 横');
  const [big, setBig] = useState(false);
  const [pdfOpts, setPdfOptsState] = useState<PdfOptions>(loadPdfOptions);
  const setPdfOpts = (o: PdfOptions) => {
    setPdfOptsState(o);
    savePdfOptions(o);
  };

  const slotsOn = (cid: string, all: string[]) => (slotSel[cid] ? all.filter((s) => slotSel[cid].includes(s)) : all);
  const chosen: PdfCal[] = useMemo(
    () =>
      ws.calendars
        .filter((c) => sel.has(c.id))
        .map((c) => ({ cal: c, slots: slotsOn(c.id, c.slots), events: publicEvents(c) }))
        .filter((c) => c.slots.length),
    [ws, sel, slotSel],
  );
  const held = ws.calendars.filter((c) => sel.has(c.id)).map((c) => ({ c, n: unpublishedChanges(c).length, d: draftCount(c) })).filter((x) => x.n || x.d);
  const scopeName = chosen.length === ws.calendars.length && chosen.every((c) => c.slots.length === c.cal.slots.length) ? 'すべて' : chosen.map((c) => (c.slots.length === c.cal.slots.length ? c.cal.name : `${c.cal.name}（${c.slots.join('・')}）`)).join('・');

  const reload = () => listShareLinks(ws.id).then(setLinks).catch((e) => setErr(e.message));
  useEffect(() => {
    if (canManage) reload();
  }, [ws.id, canManage]);

  const buildScope = (): ShareScope | null => {
    const scope: ShareScope = {};
    if (sel.size < ws.calendars.length) scope.layers = [...sel];
    const slots: Record<string, string[]> = {};
    for (const c of chosen) if (c.slots.length < c.cal.slots.length) slots[c.cal.id] = c.slots;
    if (Object.keys(slots).length) scope.slots = slots;
    if (from) scope.from = from;
    if (to) scope.to = to;
    return Object.keys(scope).length ? scope : null;
  };
  const make = async () => {
    try {
      await createShareLink(ws.id, label.trim() || '共有リンク', buildScope());
      setLabel('');
      await reload();
      toast('リンクを作りました');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const latest = links.find((l) => !l.revoked_at);
  const versionsNote = chosen.map((c) => (c.cal.publishedAt ? `${c.cal.name}: 公開 ${c.cal.publishedAt.slice(0, 10)}` : c.cal.versions.find((v) => v.status === 'approved') ? `${c.cal.name}: ${c.cal.versions.find((v) => v.status === 'approved')!.label}` : '')).filter(Boolean).join('　');

  return (
    <>
      <Panel title="共有・出力" wide onClose={onClose}>
        <p className="hint">何を、いつからいつまで。選んだ分だけが相手に見えます。</p>
        <div className="form">
          <div className="choices">
            {ws.calendars.map((c) => (
              <div key={c.id} className={`choice${sel.has(c.id) ? ' on' : ''}`} style={{ padding: '6px 10px', display: 'grid', gap: 4 }}>
                <label style={{ display: 'grid', gridTemplateColumns: '16px 12px 1fr', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sel.has(c.id)}
                    onChange={() => {
                      const n = new Set(sel);
                      n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                      setSel(n);
                    }}
                    style={{ margin: 0 }}
                  />
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color }} />
                  <b>{c.name}</b>
                </label>
                {c.slots.length > 1 && sel.has(c.id) && (
                  <div style={{ marginLeft: 34 }}>
                    <SlotPick slots={c.slots} value={slotsOn(c.id, c.slots)} onChange={(v) => setSlotSel({ ...slotSel, [c.id]: v })} title="班（チェックした班だけがリンク・ICS・PDF に入ります）" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="row2">
            <label>
              開始
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              終了
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        </div>
        {held.length > 0 && (
          <div className="notice">
            {held.map((x) => `${x.c.name}: ${x.n ? `未公開の変更 ${x.n} 件` : ''}${x.n && x.d ? '、' : ''}${x.d ? `下書き ${x.d} 件` : ''}`).join(' / ')} は相手に見えません。
            {held.some((x) => x.n) && '左の「公開する」で反映されます。'}
          </div>
        )}
        <div className="tabs">
          <button className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>
            閲覧リンク
          </button>
          <button className={tab === 'ics' ? 'on' : ''} onClick={() => setTab('ics')}>
            カレンダーに追加（ICS）
          </button>
          <button className={tab === 'pdf' ? 'on' : ''} onClick={() => setTab('pdf')}>
            PDF
          </button>
        </div>
        {err && <div className="error">{err}</div>}

        {tab === 'link' && (
          <>
            <p className="hint">リンクを知っている人が、承認済み・公開済みの予定だけを見られます。取り消すとすぐ見られなくなります。</p>
            {canManage ? (
              <>
                <label className="hint">
                  名前（誰に渡すか）
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: サッカー部 保護者向け" />
                </label>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                  <button className="primary" onClick={make} disabled={!chosen.length}>
                    リンクを作る
                  </button>
                  <span className="hint">{scopeName}、{md(from)}〜{md(to)}</span>
                </div>
                <h3 style={{ fontSize: 13, marginTop: 10 }}>発行済み</h3>
                {links.length === 0 && <p className="hint">まだありません</p>}
                {links.map((l) => (
                  <div key={l.token} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', opacity: l.revoked_at ? 0.5 : 1 }}>
                    <b>{l.label ?? '共有リンク'}</b>
                    {l.revoked_at && <span className="badge">取消済み</span>}
                    <div className="hint">{describeScope(ws, l.scope)}</div>
                    {!l.revoked_at && (
                      <div className="url">
                        <span>{shareUrl(l.token)}</span>
                        <button onClick={() => copyText(shareUrl(l.token), toast)}>コピー</button>
                        <a className="gcal" href={shareUrl(l.token)} target="_blank" rel="noopener">
                          開く
                        </a>
                        <button className="danger" onClick={() => revokeShareLink(l.token).then(reload).then(() => toast('取り消しました')).catch((e) => setErr(e.message))}>
                          取り消す
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <p className="hint">リンクの発行は管理者か先生ができます。</p>
            )}
          </>
        )}

        {tab === 'ics' && (
          <>
            <p className="hint">スマホのカレンダーに入れる URL です。予定が変わると自動で更新されます。URL はリンクごとに決まるので、先に「閲覧リンク」を 1 つ作ってください。</p>
            {latest ? (
              <>
                <div className="url">
                  <span>{icsUrl(latest.token)}</span>
                  <button onClick={() => copyText(icsUrl(latest.token), toast)}>コピー</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a className="gcal" href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(icsUrl(latest.token).replace(/^https?/, 'webcal'))}`} target="_blank" rel="noopener">
                    Google カレンダーに追加
                  </a>
                  <button className="gcal" onClick={() => copyText(icsUrl(latest.token).replace(/^https?/, 'webcal'), toast)}>
                    iPhone・Mac 用の URL をコピー
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                  <div>班ごとに別の URL もあります。班をまたぐ予定（全員参加の大会など）は、それぞれの班のカレンダーに 1 件ずつ入ります。</div>
                  {chosen
                    .filter((c) => c.cal.slots.length > 1)
                    .map((c) =>
                      c.slots.map((s) => (
                        <div className="url" key={`${c.cal.id}|${s}`}>
                          <span>
                            <b style={{ fontFamily: 'var(--font)' }}>
                              {c.cal.name} {s}
                            </b>
                            　{icsUrl(latest.token, c.cal.id, s)}
                          </span>
                          <button onClick={() => copyText(icsUrl(latest.token, c.cal.id, s), toast)}>コピー</button>
                        </div>
                      )),
                    )}
                  <div>Bekuta にはこの URL を登録すると、練習日と休止期間（考査）が取り込まれます。</div>
                </div>
              </>
            ) : (
              <p className="notice">まず「閲覧リンク」タブでリンクを作ってください。その範囲の ICS URL がここに出ます。</p>
            )}
          </>
        )}

        {tab === 'pdf' && (
          <>
            <div className="row2">
              <label className="hint">
                レイアウト
                <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
                  {LAYOUTS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="hint">
                用紙
                <select value={paper} onChange={(e) => setPaper(e.target.value)}>
                  {Object.keys(PAPERS).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <PdfOptionsPicker layout={layout} value={pdfOpts} onChange={setPdfOpts} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <button onClick={() => setBig(true)}>大きく見る</button>
              <span className="hint">
                {scopeName}、{md(from)}〜{md(to)}。用紙の縦横比どおり
              </span>
            </div>
            <PdfPages wsName={ws.name} cals={chosen} from={from} to={to} layout={layout} paper={paper} versionsNote={versionsNote} options={pdfOpts} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button
                className="primary"
                onClick={() => {
                  const key = savePrintJob({ wsId: token ? undefined : ws.id, token, sel: [...sel], slotSel, from, to, layout, paper, options: pdfOpts });
                  window.open(`${location.pathname}#print/${key}`, '_blank');
                }}
              >
                PDF を保存
              </button>
              <span className="hint">印刷用の画面が開き、この見た目のまま「PDF に保存」できます（用紙サイズと余白は自動）。</span>
            </div>
          </>
        )}
      </Panel>
      {big && (
        <div className="pdfmodal">
          <div className="bar">
            <b>PDF プレビュー（実寸比）</b>
            <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
              {LAYOUTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select value={paper} onChange={(e) => setPaper(e.target.value)}>
              {Object.keys(PAPERS).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span style={{ color: '#ddd', fontSize: 12 }}>
              {md(from)}〜{md(to)}
            </span>
            <PdfOptionsPicker layout={layout} value={pdfOpts} onChange={setPdfOpts} />
            <span className="spacer" />
            <button onClick={() => setBig(false)}>閉じる</button>
          </div>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <PdfPages wsName={ws.name} cals={chosen} from={from} to={to} layout={layout} paper={paper} versionsNote={versionsNote} options={pdfOpts} />
          </div>
        </div>
      )}
    </>
  );
}

function describeScope(ws: Workspace, scope: ShareScope | null): string {
  if (!scope) return 'すべてのカレンダー';
  const cals = scope.layers ? ws.calendars.filter((c) => scope.layers!.includes(c.id)) : ws.calendars;
  const parts = cals.map((c) => (scope.slots?.[c.id] ? `${c.name}（${scope.slots[c.id].join('・')}）` : c.name));
  const period = scope.from || scope.to ? ` / ${scope.from ? md(scope.from) : ''}〜${scope.to ? md(scope.to) : ''}` : '';
  return (parts.length === ws.calendars.length && !scope.slots ? 'すべてのカレンダー' : parts.join('・')) + period;
}
