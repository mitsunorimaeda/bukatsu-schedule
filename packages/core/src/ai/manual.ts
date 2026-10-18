/**
 * API キーなしで AI を使う経路（ChatGPT / Gemini / Claude の画面に PDF と指示文を貼り、返ってきた JSON を貼り戻す）。
 * サーバー側の構造化出力と同じスキーマ・同じ変換を通すので、結果の扱いは API 経由と同じ。Node 非依存。
 */
import type { ClubTableResult, Prompt, SchoolCalendarResult } from './prompts.js';

/** 画面に貼る指示文。system + 本文 + スキーマ */
export function manualPrompt<T>(p: Prompt<T>, vars: Record<string, string>): string {
  return [
    p.system,
    '',
    p.render(vars),
    '',
    '出力は説明文を付けず、次の JSON スキーマに従う JSON だけにしてください。JSON はコードブロック（```json）で囲ってかまいません。',
    '件数が多くても省略せず全件出してください。長くて途中で切れた場合は、続きを同じ形式の JSON で出してください（アプリ側でつなぎます）。',
    '',
    JSON.stringify(p.schema),
  ].join('\n');
}

function jsonBlocks(text: string): unknown[] {
  const out: unknown[] = [];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const sources = fenced.length ? fenced : [text];
  for (const src of sources) {
    // 先頭の { から対応する } までを順に拾う（複数回答をまとめて貼った場合に対応）
    let i = src.indexOf('{');
    while (i >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let end = -1;
      for (let j = i; j < src.length; j++) {
        const ch = src[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) break;
      try {
        out.push(JSON.parse(src.slice(i, end + 1)));
      } catch {
        /* 壊れた断片は飛ばす */
      }
      i = src.indexOf('{', end + 1);
    }
  }
  return out;
}

/** 貼り付けられた返事から結果を取り出す。複数の JSON（続き）があれば cells / items をつなぐ */
export function parseManualResult(text: string, kind: 'club-table'): ClubTableResult;
export function parseManualResult(text: string, kind: 'school-calendar'): SchoolCalendarResult;
export function parseManualResult(text: string, kind: 'club-table' | 'school-calendar'): ClubTableResult | SchoolCalendarResult {
  const key = kind === 'club-table' ? 'cells' : 'items';
  const objs = jsonBlocks(text).filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && Array.isArray((o as Record<string, unknown>)[key]));
  if (objs.length === 0) {
    if (!text.trim()) throw new Error('AI の返事を貼ってください');
    if (text.includes('{')) throw new Error(`JSON として読めませんでした。途中で切れていれば AI に「続きを出して」と頼み、返事をそのまま続けて貼ってください（「${key}」の配列が必要です）`);
    throw new Error('JSON が見つかりません。AI の返事（コードブロックごと）を全部コピーして貼ってください');
  }
  const first = objs[0];
  const rows = objs.flatMap((o) => o[key] as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).date === 'string' && typeof (r as Record<string, unknown>).text === 'string');
  if (rows.length === 0) throw new Error(`「${key}」の中に date と text を持つ項目がありません`);
  if (kind === 'club-table') {
    const categories = Array.isArray(first.categories) ? (first.categories as string[]) : [...new Set(rows.map((r) => String(r.category ?? '全体')))];
    return { title: String(first.title ?? ''), year: Number(first.year) || new Date().getFullYear(), month: Number(first.month) || 0, categories, cells: rows.map((r) => ({ date: String(r.date), end_date: r.end_date == null ? null : String(r.end_date), category: String(r.category ?? categories[0] ?? '全体'), text: String(r.text), place: r.place == null ? null : String(r.place), merged: !!r.merged, highlighted: !!r.highlighted })), notes: Array.isArray(first.notes) ? (first.notes as string[]) : [] } as ClubTableResult;
  }
  return { fiscal_year: Number(first.fiscal_year) || new Date().getFullYear(), months: Array.isArray(first.months) ? (first.months as string[]) : [], items: rows.map((r) => ({ date: String(r.date), end_date: r.end_date == null ? null : String(r.end_date), column: String(r.column ?? '生徒'), text: String(r.text), approximate: !!r.approximate })) } as SchoolCalendarResult;
}
