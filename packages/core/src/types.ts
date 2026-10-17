/** 共通データモデル（docs/plan.md 3 章） */

export type LayerType = 'school' | 'club' | 'external' | 'manual';

export type ClubKind =
  | 'practice'
  | 'match'
  | 'competition'
  | 'off'
  | 'self'
  | 'pause:test'
  | 'pause:holiday'
  | 'event'
  | 'unknown';

export type SchoolKind = 'class' | 'no_class' | 'exam' | 'school_event' | 'holiday';

export type ExternalKind = 'external_event';

export type Kind = ClubKind | SchoolKind | ExternalKind;

export const KIND_LABEL: Record<Kind, string> = {
  practice: '練習',
  match: '試合',
  competition: '大会',
  off: '休み',
  self: '各自練習',
  'pause:test': 'テスト期間',
  'pause:holiday': '休止期間',
  event: '行事',
  unknown: '未定',
  class: '授業',
  no_class: '授業なし',
  exam: '考査',
  school_event: '学校行事',
  holiday: '休日',
  external_event: '外部予定',
};

/** 終日として扱う種類（時刻があっても終日にする） */
export const ALLDAY_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'off',
  'self',
  'pause:test',
  'pause:holiday',
  'unknown',
  'no_class',
  'exam',
  'holiday',
  'class',
]);

/** 連続する日を 1 件の期間に畳んでよい種類 */
export const SPAN_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'off',
  'self',
  'pause:test',
  'pause:holiday',
  'exam',
  'no_class',
  'holiday',
]);

/** 予定が「空き」扱いになる種類（ICS の TRANSP:TRANSPARENT） */
export const TRANSPARENT_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'off',
  'self',
  'pause:test',
  'pause:holiday',
  'exam',
  'no_class',
  'holiday',
]);

export interface ScheduleEvent {
  /** (school, layer, category, date, kind) から決まる安定 ID。版をまたいで同一 */
  uid: string;
  school: string;
  /** 層の ID（例: school, club:track, external:fencing-assoc, manual:teacher-1） */
  layer: string;
  layerType: LayerType;
  /** 部内の班。無ければ「全体」。学校予定は対象（全校 / 生徒 / 学校・その他 など） */
  category: string;
  /** 班をまたぐ予定（全員参加の大会など）はここに全部の班。無ければ [category] */
  slots?: string[];
  /** YYYY-MM-DD */
  date: string;
  /** 期間イベントの最終日（含む）。単日なら無し */
  endDate?: string;
  kind: Kind;
  /** HH:MM（JST）。無ければ終日 */
  timeStart?: string;
  timeEnd?: string;
  place?: string;
  /** カレンダー・配布用表に出す件名。人名を含めない */
  title: string;
  note?: string;
  /** 出どころのセル位置など */
  sourceRef?: string;
  /** AI 読みのときの確信度 */
  confidence?: number;
}

/** uid を除いた入力。normalize() が uid を付ける */
export type ScheduleEventInput = Omit<ScheduleEvent, 'uid'>;

export interface SchoolSettings {
  /** 放課後の開始時刻（「業後」の開始）。既定 15:30 */
  afterSchoolStart: string;
  /** 終了不明の練習の既定時間（分）。既定 120 */
  defaultDurationMin: number;
  /** 年度の開始月。既定 4 */
  fiscalYearStartMonth: number;
}

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  afterSchoolStart: '15:30',
  defaultDurationMin: 120,
  fiscalYearStartMonth: 4,
};

/** 版（取り込み 1 回分） */
export interface SourceVersion {
  id: string;
  school: string;
  layer: string;
  sourceId: string;
  /** PDF の版番号や取得日時など、人が読むラベル */
  label: string;
  importedAt: string;
  fileHash?: string;
  aiModel?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type ChangeType = 'added' | 'removed' | 'changed';

export interface EventChange {
  uid: string;
  change: ChangeType;
  before?: ScheduleEvent;
  after?: ScheduleEvent;
  /** 変わった項目名 */
  fields: (keyof ScheduleEvent)[];
}
