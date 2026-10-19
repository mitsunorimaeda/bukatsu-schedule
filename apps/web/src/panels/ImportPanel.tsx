import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SCHOOL_SETTINGS } from '@bukatsu/core/browser';
import { CLUB_TABLE_PROMPT, READ_LAYOUTS, READ_PLACES, READ_SUBJECTS, SCHOOL_CALENDAR_PROMPT, clubTableToEvents, manualPrompt, mergeSpans, normalize, parseManualResult, readOptionsToVars, schoolItemsToEvents } from '@bukatsu/core/browser';
import type { ReadLayout, ReadOptions, ReadPlace } from '@bukatsu/core/browser';
import { createPendingVersion, loadAiUsageYen, saveCalendar, saveSchoolSettings, supabase } from '../api';
import type { Calendar, Workspace } from '../model';
import { Panel, useToast } from '../ui';

type Mode = 'api' | 'manual';

function currentFiscalYear(): number {
  const d = new Date();
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

/** 読み方の設定の初期値。カレンダーに保存済みならそれ、無ければ種類から推定 */
function initialReadOptions(cal: Calendar | undefined): ReadOptions {
  const saved = (cal?.source?.read as ReadOptions | undefined) ?? {};
  const school = cal?.type === 'school';
  const layout: ReadLayout = saved.layout ?? (school ? 'year-grid' : 'date-rows');
  return {
    subject: saved.subject ?? (school ? '学校行事' : '部活動'),
    layout,
    year: saved.year ?? (layout === 'year-grid' ? currentFiscalYear() : new Date().getFullYear()),
    place: saved.place ?? 'none',
    extra: saved.extra ?? '',
  };
}

/**
 * 指示文を表に合わせるための質問（何の表か・形・年・場所・補足）。
 * 答えはカレンダーに保存され、次回からそのまま使える。API 経路でも同じ答えをサーバーに渡す。
 */
function ReadQuestions({ ro, onChange, slots }: { ro: ReadOptions; onChange: (o: ReadOptions) => void; slots: string[] }) {
  const known = READ_SUBJECTS.some((s) => s.id === ro.subject);
  const [other, setOther] = useState(!known);
  const set = (patch: Partial<ReadOptions>) => onChange({ ...ro, ...patch });
  const yearIsFiscal = ro.layout === 'year-grid';
  return (
    <div className="readq">
      <div className="readq-title">
        <b>読み方を表に合わせる</b>
        <span className="hint">答えに合わせて指示文が変わります。次回から覚えています。</span>
      </div>
      <div className="readq-grid">
        <label>
          何の予定表ですか
          <select
            value={other ? 'other' : ro.subject}
            onChange={(e) => {
              if (e.target.value === 'other') {
                setOther(true);
                set({ subject: '' });
              } else {
                setOther(false);
                set({ subject: e.target.value });
              }
            }}
          >
            {READ_SUBJECTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="other">その他（自分で書く）</option>
          </select>
          {other && <input value={ro.subject ?? ''} placeholder="例: 地域のスポーツ少年団" onChange={(e) => set({ subject: e.target.value })} />}
        </label>
        <label>
          表の形
          <select value={ro.layout} onChange={(e) => set({ layout: e.target.value as ReadLayout })}>
            {READ_LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <span className="hint">{READ_LAYOUTS.find((l) => l.id === ro.layout)?.desc}</span>
        </label>
        <label>
          {yearIsFiscal ? '年度（西暦、4 月始まり）' : '年（西暦）'}
          <input type="number" inputMode="numeric" value={ro.year ?? ''} placeholder="空なら曜日から推定" onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <label>
          場所の書かれ方
          <select value={ro.place} onChange={(e) => set({ place: e.target.value as ReadPlace })}>
            {READ_PLACES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          読み方の補足（任意）
          <input value={ro.extra ?? ''} placeholder="例: 右端の曜日列は無視 / 赤字は変更点 / 2 ページ目は読まない" onChange={(e) => set({ extra: e.target.value })} />
        </label>
      </div>
      <p className="hint">{slots.length > 1 ? `区分（列）は「${slots.join(' / ')}」として読みます。表にそれ以外の区分があれば、読み取り後に班として追加できます。` : '区分（班）は 1 つなので、すべて同じ列として読みます。'}</p>
    </div>
  );
}

/**
 * 取り込み（PDF・写真）。2 つの経路があり、どちらも「確認待ち」の版になる。
 *  api:    このアプリに読ませる（サーバーの /api/import が Claude API で読む。運営が鍵を置いている場合）
 *  manual: 自分の AI に読ませる（アプリが作った指示文を ChatGPT / Gemini / Claude の画面に PDF と一緒に貼り、返事を貼り戻す。鍵も費用も不要）
 */
export function ImportPanel({ ws, calId, onClose, onDone }: { ws: Workspace; calId?: string; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const candidates = ws.calendars.filter((c) => c.type !== 'manual' && c.type !== 'external');
  const [target, setTarget] = useState(calId ?? candidates[0]?.id ?? ws.calendars[0]?.id ?? '');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('bukatsu:importMode') as Mode) || 'api';
    } catch {
      return 'api';
    }
  });
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string>();
  const [savingHol, setSavingHol] = useState(false);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [result, setResult] = useState<{ count: number; costYen?: number; unknownSlots: string[]; skipped?: string[] } | null>(null);
  const cal: Calendar | undefined = ws.calendars.find((c) => c.id === target);
  const kind = cal?.type === 'school' ? 'school-calendar' : 'club-table';

  useEffect(() => {
    fetch('/api/import')
      .then((r) => (r.ok ? r.json() : { aiConfigured: false }))
      .then((b: { aiConfigured?: boolean }) => setAiConfigured(!!b.aiConfigured))
      .catch(() => setAiConfigured(false));
  }, []);
  useEffect(() => {
    if (aiConfigured === false) setMode('manual');
  }, [aiConfigured]);
  // 今月の AI 読み取りの使用額と上限（学校の設定）
  const limitYen = ws.settings.aiMonthlyYen ?? DEFAULT_SCHOOL_SETTINGS.aiMonthlyYen ?? 1000;
  const [usedYen, setUsedYen] = useState<number | null>(null);
  const [limitDraft, setLimitDraft] = useState(String(limitYen));
  useEffect(() => {
    if (aiConfigured) loadAiUsageYen(ws.id).then(setUsedYen).catch(() => setUsedYen(null));
  }, [aiConfigured, ws.id]);
  const overLimit = usedYen != null && usedYen >= limitYen;
  const saveLimit = async () => {
    const v = Math.max(0, Math.round(Number(limitDraft)));
    if (!Number.isFinite(v) || v === limitYen) return setLimitDraft(String(limitYen));
    try {
      await saveSchoolSettings(ws.id, { ...ws.settings, aiMonthlyYen: v });
      await onDone();
      toast(`AI 読み取りの上限を月 ${v} 円にしました`);
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    setErr(undefined);
    try {
      localStorage.setItem('bukatsu:importMode', m);
    } catch {
      /* 使えなくてよい */
    }
  };

  const [ro, setRo] = useState<ReadOptions>(() => initialReadOptions(cal));
  useEffect(() => {
    setRo(initialReadOptions(cal));
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal?.id]);
  const vars = useMemo(() => (cal ? { ...readOptionsToVars(ro), categories: cal.slots.join(', ') } : {}), [ro, cal]);
  const prompt = useMemo(() => {
    if (!cal) return '';
    return kind === 'school-calendar' ? manualPrompt(SCHOOL_CALENDAR_PROMPT, vars) : manualPrompt(CLUB_TABLE_PROMPT, vars);
  }, [cal, kind, vars]);

  /** 答えをカレンダーに覚えさせる（失敗しても取り込みは続ける） */
  const rememberReadOptions = async () => {
    if (!cal) return;
    const prev = (cal.source?.read as ReadOptions | undefined) ?? {};
    const next: ReadOptions = { subject: ro.subject, layout: ro.layout, year: ro.year, place: ro.place, extra: ro.extra?.trim() || undefined };
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    try {
      await saveCalendar(ws.id, { id: cal.id, name: cal.name, color: cal.color, type: cal.type, slots: cal.slots, publishMode: cal.publishMode, source: { ...(cal.source ?? { kind: 'manual' }), read: next } });
    } catch {
      /* 覚えられなくても取り込みはできる */
    }
  };

  const copyPrompt = async () => {
    void rememberReadOptions();
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast('指示文をコピーしました。AI の画面に PDF と一緒に貼ってください');
    } catch {
      setShowPrompt(true);
      setErr('コピーできませんでした。下の指示文を選んでコピーしてください');
    }
  };

  /** 経路 api: サーバーに読ませる */
  const startApi = async () => {
    if (!file || !cal) return;
    setErr(undefined);
    setStep(2);
    setProgress(5);
    void rememberReadOptions();
    const texts = ['ファイルを送っています…', '表の形（列と区分の対応）を読んでいます…', '複数の列にまたがるマスを各区分に展開しています…', '日付と時刻を整えています…'];
    let i = 0;
    setMsg(texts[0]);
    const timer = setInterval(() => {
      i = Math.min(i + 1, texts.length - 1);
      setMsg(texts[i]);
      setProgress((p) => Math.min(90, p + 12));
    }, 4000);
    try {
      const session = (await supabase()!.auth.getSession()).data.session;
      if (!session) throw new Error('ログインが切れています');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('schoolId', ws.id);
      fd.append('calendarId', cal.id);
      fd.append('kind', kind);
      fd.append('label', file.name.replace(/\.[^.]+$/, ''));
      fd.append('variables', JSON.stringify(vars));
      const res = await fetch('/api/import', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: fd });
      const body = (await res.json()) as { error?: string; count: number; costYen: number; unknownSlots: string[] };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setProgress(100);
      setResult(body);
      loadAiUsageYen(ws.id).then(setUsedYen).catch(() => undefined);
      setStep(3);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setStep(1);
      loadAiUsageYen(ws.id).then(setUsedYen).catch(() => undefined);
    } finally {
      clearInterval(timer);
    }
  };

  /** 経路 manual: 貼り付けられた返事を、サーバーと同じ変換に通して保存 */
  const startManual = async () => {
    if (!cal) return;
    setErr(undefined);
    try {
      const fileRef = 'manual-ai';
      let events;
      const skipped: string[] = [];
      if (kind === 'school-calendar') {
        const r = parseManualResult(pasted, 'school-calendar');
        const conv = schoolItemsToEvents(r, { school: ws.id, layer: cal.id, fileRef, prefixCategories: (cal.source?.prefixCategories as Record<string, string> | undefined) ?? { '南:': '南校舎', '南：': '南校舎' } });
        skipped.push(...conv.warnings);
        events = mergeSpans(normalize(conv.events, ws.settings));
      } else {
        const r = parseManualResult(pasted, 'club-table');
        const conv = clubTableToEvents(r, { school: ws.id, layer: cal.id, fileRef, settings: ws.settings, categoryAliases: cal.source?.categoryAliases as Record<string, string[]> | undefined, onSkip: (c) => skipped.push(`${c.date} ${c.category}: ${c.text.slice(0, 20)}`) });
        events = mergeSpans(normalize(conv, ws.settings));
      }
      if (events.length === 0) throw new Error(`予定が 1 件も作れませんでした${skipped.length ? `（日付が読めない行 ${skipped.length}: ${skipped.slice(0, 2).join(' / ')}）` : ''}。返事の中身を確かめてください`);
      const label = `${new Date().toLocaleDateString('ja-JP')} 自分の AI で読み取り`;
      const r = await createPendingVersion(ws.id, cal, label, events, fileRef);
      setResult({ ...r, skipped });
      setStep(3);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const addUnknownSlots = async () => {
    if (!cal || !result) return;
    await saveCalendar(ws.id, { id: cal.id, name: cal.name, color: cal.color, type: cal.type, slots: [...cal.slots, ...result.unknownSlots], publishMode: cal.publishMode, source: cal.source });
    await onDone();
    toast(`班「${result.unknownSlots.join('・')}」を追加しました`);
    setResult({ ...result, unknownSlots: [] });
  };

  return (
    <Panel title="PDF・写真を取り込む" onClose={onClose}>
      <div className="steps">
        <b style={{ color: step >= 1 ? 'var(--ink)' : undefined }}>1 ファイル</b>›<span style={step >= 2 ? { color: 'var(--ink)', fontWeight: 700 } : undefined}>2 読み取り</span>›<span style={step >= 3 ? { color: 'var(--ink)', fontWeight: 700 } : undefined}>3 確認して反映</span>
      </div>
      {step === 1 && (
        <div className="form">
          <label>
            どのカレンダーに入れますか
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {ws.calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="seg" role="radiogroup" aria-label="読ませ方">
            <button className={mode === 'api' ? 'on' : ''} disabled={aiConfigured === false} title={aiConfigured === false ? 'このサーバーには AI の鍵が置かれていません' : ''} onClick={() => pickMode('api')}>
              このアプリに読ませる
              <small>{aiConfigured === false ? '（このサーバーでは使えません）' : '1 枚 20〜25 円・1〜2 分'}</small>
            </button>
            <button className={mode === 'manual' ? 'on' : ''} onClick={() => pickMode('manual')}>
              自分の AI に読ませて貼り付ける
              <small>ChatGPT・Gemini・Claude の画面で。無料</small>
            </button>
          </div>

          {cal && <ReadQuestions key={cal.id} ro={ro} onChange={setRo} slots={cal.slots} />}
          <label className="checkline" title={ws.role === 'admin' ? '' : '管理者だけが変えられます'}>
            <input
              type="checkbox"
              checked={ws.settings.skipNationalHolidays !== false}
              disabled={ws.role !== 'admin' || savingHol}
              onChange={async (e) => {
                setSavingHol(true);
                try {
                  await saveSchoolSettings(ws.id, { ...ws.settings, skipNationalHolidays: e.target.checked });
                  await onDone();
                } catch (x) {
                  setErr((x as Error).message);
                } finally {
                  setSavingHol(false);
                }
              }}
            />
            国民の祝日は取り込まない
            <small>「海の日」「祝日」だけのマスは飛ばします。スマホのカレンダーの祝日と重なるため。祝日の日の練習や行事は残ります</small>
          </label>

          {mode === 'api' && (
            <>
              <div
                className={`drop${over ? ' on' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  setFile(e.dataTransfer.files[0] ?? null);
                }}
              >
                <div>{file ? `${file.name}（${Math.round(file.size / 1024)} KB）` : 'ここに PDF・写真をドロップ'}</div>
                <div className="hint">
                  または{' '}
                  <label style={{ color: 'var(--ink)', cursor: 'pointer', textDecoration: 'underline' }}>
                    ファイルを選ぶ
                    <input type="file" accept=".pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              </div>
              <p className="hint">
                ファイルは読み取りのためだけに Anthropic の Claude API に送られ、保存されません。生徒の氏名は取り込みません。
              </p>
              <div className={`aiquota${overLimit ? ' over' : usedYen != null && usedYen >= limitYen * 0.8 ? ' near' : ''}`}>
                <span>
                  今月の AI 読み取り: <b>約 {usedYen == null ? '…' : Math.round(usedYen).toLocaleString()} 円</b> / 上限 {limitYen.toLocaleString()} 円
                </span>
                {ws.role === 'admin' && (
                  <label>
                    上限
                    <input type="number" min={0} step={100} value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} onBlur={saveLimit} onKeyDown={(e) => e.key === 'Enter' && saveLimit()} />円/月
                  </label>
                )}
                {overLimit && <small>今月の上限に達しました。{ws.role === 'admin' ? '上限を上げるか、' : '管理者に上限を上げてもらうか、'}「自分の AI に読ませて貼り付ける」を使ってください。</small>}
              </div>
              {err && <div className="error">{err}</div>}
              <button className="primary" disabled={!file || !cal || overLimit} onClick={startApi}>
                読み取りを始める
              </button>
            </>
          )}

          {mode === 'manual' && (
            <>
              <ol className="howto-steps">
                <li>
                  <div className="acts">
                    <button className={copied ? '' : 'primary'} onClick={copyPrompt} disabled={!cal}>
                      {copied ? '✓ 指示文をコピーしました（もう一度コピー）' : '1. 指示文をコピー'}
                    </button>
                    <button className="ghost" onClick={() => setShowPrompt((v) => !v)}>
                      {showPrompt ? '指示文を隠す' : '指示文を見る'}
                    </button>
                  </div>
                  {showPrompt && <textarea readOnly value={prompt} rows={8} onFocus={(e) => e.currentTarget.select()} />}
                </li>
                <li>
                  <b>2.</b> いつも使っている AI（ChatGPT・Gemini・Claude）を開き、<b>PDF か写真を添付</b>して、コピーした指示文を貼って送信。
                  <div className="hint">表の読み取りの正確さは AI によって差があります。結果がずれるときは別の AI や、その AI の「じっくり考える」モードを試してください。読み取り後の確認画面で直せます。</div>
                </li>
                <li>
                  <b>3.</b> 返ってきた返事を<b>全部コピー</b>して、ここに貼る（コードブロックごとで大丈夫。途中で切れたら「続きを出して」と頼み、続けて貼る）。
                  <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={7} placeholder='{"title": ..., "cells": [ ... ]}' />
                </li>
              </ol>
              <div className="notice">
                PDF はあなたが選んだ AI サービスに送られ、そのサービスの規約に従います。<b>無料プランは入力を学習に使う設定が既定の場合があります。</b>学校の予定表を入れる前に、その AI の設定で「モデルの改善に使う」を切るか、学校・職場のアカウントを使ってください。このアプリのサーバーには、貼り付けた結果だけが届きます。
              </div>
              {err && <div className="error">{err}</div>}
              <button className="primary" disabled={!pasted.trim() || !cal} onClick={startManual}>
                貼り付けた結果を読み込む
              </button>
            </>
          )}
          <p className="hint">Google シート / CSV は、カレンダーの設定（⚙）で「Google シート / CSV をつなぐ」を選ぶと URL を登録して取り込めます。</p>
        </div>
      )}
      {step === 2 && (
        <div>
          <p>{file?.name} を読んでいます。1〜2 分かかります。この画面を閉じても続きます。</p>
          <div className="progress">
            <i style={{ width: `${progress}%` }} />
          </div>
          <p className="hint">{msg}</p>
        </div>
      )}
      {step === 3 && result && (
        <div className="form">
          <p>
            {cal?.name} に <b>{result.count} 件</b>を読み取りました{result.costYen != null ? `（約 ${result.costYen} 円）` : ''}。「確認待ち」として左に出ています。
          </p>
          {result.skipped && result.skipped.length > 0 && (
            <div className="notice">
              日付が読めず飛ばした行が {result.skipped.length} 件あります: {result.skipped.slice(0, 3).join(' / ')}
              {result.skipped.length > 3 ? ' …' : ''}。必要なら AI に「日付は YYYY-MM-DD で」と頼んで貼り直してください。
            </div>
          )}
          {result.unknownSlots.length > 0 && (
            <div className="notice">
              設定にない班がありました: {result.unknownSlots.join('・')}
              <div style={{ marginTop: 4 }}>
                <button onClick={addUnknownSlots}>この班を追加する</button>
              </div>
            </div>
          )}
          <p className="hint">次に、左の「確認して反映」で公開中との違いを見てから反映してください。反映するまで外には出ません。</p>
          <button className="primary" onClick={onClose}>
            閉じて確認する
          </button>
        </div>
      )}
    </Panel>
  );
}
