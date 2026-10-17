import { AiReader } from '@bukatsu/core';
import type { LayerConfig, SchoolConfig } from './config.js';
import { importClubPdf } from './club-pdf.js';
import { importFencingCsv } from './fencing-csv.js';
import { importSchoolPdf } from './school-pdf.js';
import { importTrackXlsx } from './track-xlsx.js';
import type { ImportedVersion } from './types.js';

export * from './config.js';
export * from './types.js';
export * from './school-pdf.js';
export * from './track-xlsx.js';
export * from './fencing-csv.js';
export * from './club-pdf.js';

export interface ImportOptions {
  reader?: AiReader;
  online?: boolean;
}

/** 層の設定に応じて取り込みを振り分ける。返り値は版の配列（PDF は複数版になりうる） */
export async function importLayer(cfg: SchoolConfig, layer: LayerConfig, opt: ImportOptions = {}): Promise<ImportedVersion[]> {
  const reader = opt.reader ?? new AiReader();
  switch (layer.source.kind) {
    case 'manual':
      return []; // 手入力・外部予定の層は画面から直接書く。取り込みは無し
    case 'pdf':
      return layer.source.prompt === 'school-calendar' ? [await importSchoolPdf(cfg, layer, reader)] : importClubPdf(cfg, layer, reader);
    case 'xlsx':
      return [await importTrackXlsx(cfg, layer)];
    case 'csv':
      return [await importFencingCsv(cfg, layer, { online: opt.online ?? false })];
    default:
      throw new Error(`未対応の source.kind: ${(layer.source as { kind: string }).kind}`);
  }
}
