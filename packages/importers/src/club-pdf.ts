/** サッカー部型: 日付 × カテゴリ列の月間予定表 PDF → AI 読み取り（版ごと） */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AiReader, CLUB_TABLE_PROMPT, clubTableToEvents, mergeSpans, normalize } from '@bukatsu/core';
import type { LayerConfig, PdfSourceConfig, SchoolConfig } from './config.js';
import { resolvePath } from './config.js';
import type { ImportedVersion } from './types.js';

export { clubTableToEvents };

export async function importClubPdf(cfg: SchoolConfig, layer: LayerConfig, reader: AiReader): Promise<ImportedVersion[]> {
  const src = layer.source as PdfSourceConfig;
  const versions = src.versions ?? (src.path ? [{ label: basename(src.path), path: src.path }] : []);
  if (!versions.length) throw new Error(`${layer.id}: source.versions か source.path が必要です`);
  const out: ImportedVersion[] = [];
  for (const v of versions) {
    const file = resolvePath(cfg, v.path);
    const bytes = new Uint8Array(readFileSync(file));
    const res = await reader.extract(CLUB_TABLE_PROMPT, { bytes, mediaType: 'application/pdf', pages: [1, 1], variables: src.variables });
    const inputs = clubTableToEvents(res.json, {
      school: cfg.id,
      layer: layer.id,
      fileRef: `pdf:${basename(file)}`,
      settings: cfg.settings,
      categoryAliases: src.categoryAliases,
    });
    const warnings: string[] = [];
    const declared = (src.variables?.categories ?? '').split(/[,、]\s*/).filter(Boolean);
    for (const cat of res.json.categories) if (declared.length && !declared.includes(cat)) warnings.push(`設定にないカテゴリ: ${cat}`);
    out.push({
      layerId: layer.id,
      label: v.label,
      events: mergeSpans(normalize(inputs, cfg.settings)),
      source: `pdf:${v.path}`,
      aiModel: res.model,
      aiMode: res.mode,
      warnings,
    });
  }
  return out;
}
