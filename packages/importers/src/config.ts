import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { DEFAULT_SCHOOL_SETTINGS } from '@bukatsu/core';
import type { LayerType, SchoolSettings } from '@bukatsu/core';

export interface PdfVersion {
  label: string;
  path: string;
}

export interface PdfSourceConfig {
  kind: 'pdf';
  prompt: 'school-calendar' | 'club-table';
  path?: string;
  versions?: PdfVersion[];
  pages?: [number, number][];
  variables?: Record<string, string>;
  prefixCategories?: Record<string, string>;
  categoryAliases?: Record<string, string[]>;
}

export interface XlsxSourceConfig {
  kind: 'xlsx';
  path: string;
  sheet: string;
  columns: { date: string; weekday?: string; time: string; event: string };
  dateRange?: [string, string];
  timeDefaults?: Record<string, { start: string; end?: string }>;
  versionLabel?: string;
}

export interface CsvSourceConfig {
  kind: 'csv';
  url?: string;
  path?: string;
  columns: { date: string; schedule: string; events?: string; classes?: string };
  ignoreColumns?: string[];
  dateRange?: [string, string];
}

export interface ManualSourceConfig {
  kind: 'manual';
}

export type SourceConfig = PdfSourceConfig | XlsxSourceConfig | CsvSourceConfig | ManualSourceConfig;

export interface LayerConfig {
  id: string;
  type: LayerType;
  name: string;
  color?: string;
  /** 班の一覧と順序（表の列）。無ければ ['全体'] */
  slots?: string[];
  /** 公開のしかた。auto = 保存したら反映、manual = 「公開する」を押したときだけ */
  publishMode?: 'auto' | 'manual';
  source: SourceConfig;
}

export interface SchoolConfig {
  id: string;
  name: string;
  settings: SchoolSettings;
  layers: LayerConfig[];
  /** 設定ファイルの場所。相対パスの基準はリポジトリルート（設定ファイルの 1 つ上） */
  baseDir: string;
}

export function loadSchoolConfig(file: string): SchoolConfig {
  const abs = resolve(file);
  const raw = YAML.parse(readFileSync(abs, 'utf8'));
  if (!raw?.id || !Array.isArray(raw.layers)) throw new Error(`学校設定が不正です: ${file}`);
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    settings: { ...DEFAULT_SCHOOL_SETTINGS, ...(raw.settings ?? {}) },
    layers: raw.layers,
    baseDir: resolve(dirname(abs), '..'),
  };
}

export function resolvePath(cfg: SchoolConfig, p: string): string {
  return resolve(cfg.baseDir, p);
}

export function inRange(date: string, range?: [string, string]): boolean {
  if (!range) return true;
  return date >= range[0] && date <= range[1];
}
