/**
 * AI 読み取りの入口。
 *  - mock:   fixtures/ai-responses/ に記録済みの応答を返す（API キー不要。前田さんの前提 6）
 *  - live:   Claude API を叩く
 *  - record: live で叩き、応答を fixtures/ai-responses/ に保存する（キー提示後の切替用）
 * キーは (prompt.id, 入力ファイルの sha256, ページ範囲) で決まる。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prompt } from './prompts.js';

export type AiMode = 'mock' | 'live' | 'record';

export interface AiInput {
  /** PDF または画像のバイト列 */
  bytes: Uint8Array;
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg';
  /** PDF のページ範囲（1 始まり、両端含む）。省略時は全ページ */
  pages?: [number, number];
  /** プロンプトに差し込む追加情報（年度・部名・カテゴリ一覧など） */
  variables?: Record<string, string>;
}

export interface AiResult<T = unknown> {
  json: T;
  model: string;
  mode: AiMode;
  /** 記録ファイルのキー */
  key: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiReaderOptions {
  mode?: AiMode;
  recordDir?: string;
  apiKey?: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function responseKey(promptId: string, bytes: Uint8Array, pages?: [number, number]): string {
  const p = pages ? `p${pages[0]}-${pages[1]}` : 'all';
  return `${promptId}__${sha256(bytes).slice(0, 12)}__${p}`;
}

export class AiReader {
  readonly mode: AiMode;
  readonly recordDir: string;
  private readonly apiKey?: string;

  constructor(opt: AiReaderOptions = {}) {
    this.mode = opt.mode ?? ((process.env.AI_MODE as AiMode | undefined) ?? 'mock');
    this.recordDir = opt.recordDir ?? process.env.AI_RECORD_DIR ?? join(process.cwd(), 'fixtures', 'ai-responses');
    this.apiKey = opt.apiKey ?? process.env.ANTHROPIC_API_KEY;
  }

  async extract<T>(prompt: Prompt<T>, input: AiInput): Promise<AiResult<T>> {
    const key = responseKey(prompt.id, input.bytes, input.pages);
    const file = join(this.recordDir, `${key}.json`);
    if (this.mode === 'mock') {
      if (!existsSync(file)) {
        throw new Error(
          `AI モック応答がありません: ${file}\n` +
            `API キーを受け取ったら AI_MODE=record で同じ取り込みを実行すると記録されます。`,
        );
      }
      const rec = JSON.parse(readFileSync(file, 'utf8')) as RecordedResponse<T>;
      return { json: rec.json, model: rec.model, mode: 'mock', key, usage: rec.usage };
    }
    const res = await this.callClaude(prompt, input);
    if (this.mode === 'record') {
      mkdirSync(this.recordDir, { recursive: true });
      const rec: RecordedResponse<T> = {
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: res.model,
        recordedAt: new Date().toISOString(),
        pages: input.pages,
        usage: res.usage,
        json: res.json,
      };
      writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
    }
    return { ...res, mode: this.mode, key };
  }

  private async callClaude<T>(prompt: Prompt<T>, input: AiInput): Promise<Omit<AiResult<T>, 'mode' | 'key'>> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY がありません（AI_MODE=live/record には必要）');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });
    const data = Buffer.from(input.bytes).toString('base64');
    const docBlock =
      input.mediaType === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : ({ type: 'image', source: { type: 'base64', media_type: input.mediaType, data } } as const);
    const text = prompt.render(input.variables ?? {}, input.pages);
    const res = await client.messages.create({
      model: prompt.model,
      max_tokens: prompt.maxTokens ?? 16000,
      system: prompt.system,
      tools: [{ name: 'emit', description: '読み取り結果を構造化して返す', input_schema: prompt.schema as never }],
      tool_choice: { type: 'tool', name: 'emit' },
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text }] }],
    });
    const tool = res.content.find((c) => c.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') throw new Error('構造化出力（tool_use）が返りませんでした');
    return {
      json: tool.input as T,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
}

export interface RecordedResponse<T> {
  promptId: string;
  promptVersion: number;
  model: string;
  recordedAt: string;
  pages?: [number, number];
  usage?: { inputTokens: number; outputTokens: number };
  /** mock を人手で作ったときの注記 */
  note?: string;
  json: T;
}
