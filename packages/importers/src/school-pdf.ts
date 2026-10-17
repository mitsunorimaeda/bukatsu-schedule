/** 学校の年間行事予定 PDF → 学校予定レイヤー（AI 読み取り。mock / live） */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AiReader, SCHOOL_CALENDAR_PROMPT, mergeSpans, normalize, schoolItemsToEvents } from '@bukatsu/core';
import type { ScheduleEventInput } from '@bukatsu/core';
import type { LayerConfig, PdfSourceConfig, SchoolConfig } from './config.js';
import { resolvePath } from './config.js';
import type { ImportedVersion } from './types.js';

export async function importSchoolPdf(cfg: SchoolConfig, layer: LayerConfig, reader: AiReader): Promise<ImportedVersion> {
  const src = layer.source as PdfSourceConfig;
  if (!src.path) throw new Error(`${layer.id}: source.path がありません`);
  const file = resolvePath(cfg, src.path);
  const bytes = new Uint8Array(readFileSync(file));
  const ranges = src.pages ?? [undefined];
  const inputs: ScheduleEventInput[] = [];
  const warnings: string[] = [];
  let model = '';
  for (const pages of ranges) {
    const res = await reader.extract(SCHOOL_CALENDAR_PROMPT, { bytes, mediaType: 'application/pdf', pages, variables: src.variables });
    model = res.model;
    const conv = schoolItemsToEvents(res.json, { school: cfg.id, layer: layer.id, fileRef: `pdf:${basename(file)}#p${pages ? pages[0] : '*'}`, prefixCategories: src.prefixCategories });
    inputs.push(...conv.events);
    warnings.push(...conv.warnings);
  }
  return {
    layerId: layer.id,
    label: `${basename(file)} AI読み ${new Date().toISOString().slice(0, 10)}`,
    events: mergeSpans(normalize(inputs, cfg.settings)),
    source: `pdf:${src.path}`,
    aiModel: model,
    aiMode: reader.mode,
    warnings,
  };
}
