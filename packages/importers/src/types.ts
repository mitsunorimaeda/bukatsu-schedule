import type { ScheduleEvent } from '@bukatsu/core';

/** 取り込み 1 回分（= 1 版）の結果 */
export interface ImportedVersion {
  layerId: string;
  label: string;
  events: ScheduleEvent[];
  /** 出どころの説明（ファイル名・URL・シート名） */
  source: string;
  aiModel?: string;
  aiMode?: string;
  warnings: string[];
}
