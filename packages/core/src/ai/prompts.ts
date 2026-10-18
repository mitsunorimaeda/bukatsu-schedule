/**
 * 読み取りプロンプト。モデルの使い分け（前田さんの方針）:
 *  きれいな表 = Haiku 4.5、写真・複雑なレイアウト（結合セル・矢印・色）= Sonnet 5.5
 */
export const MODEL_CLEAN_TABLE = 'claude-haiku-4-5-20251001';
export const MODEL_COMPLEX_LAYOUT = 'claude-sonnet-5-5';

export interface Prompt<T> {
  id: string;
  version: number;
  model: string;
  system: string;
  schema: object;
  maxTokens?: number;
  render: (vars: Record<string, string>, pages?: [number, number]) => string;
  /** 型だけのための印 */
  _type?: T;
}

const NO_NAMES =
  '生徒の氏名（名簿・当番表・個人の遠征先に書かれた人名）は出力に含めないでください。氏名が書かれたセルは、氏名を除いた残りの文だけを出力してください。' +
  'コーチやトレーナーの名前が練習内容の一部として書かれている場合（例: 「前田さんトレーニング」）はそのまま残してください。' +
  '数字・英字・記号は半角に、全角スペースは半角に揃え、セル内の文言はそれ以外を書き換えずに写してください。';

/** 学校の年間行事予定（生徒 / 学校・その他 の 2 列、縦矢印 = 期間） */
export interface SchoolCalendarItem {
  date: string;
  end_date?: string | null;
  column: '生徒' | '学校・その他' | string;
  text: string;
  /** 表の欄外（脚注）など、日付が近似のとき true */
  approximate?: boolean;
}
export interface SchoolCalendarResult {
  fiscal_year: number;
  months: string[];
  items: SchoolCalendarItem[];
}

export const SCHOOL_CALENDAR_PROMPT: Prompt<SchoolCalendarResult> = {
  id: 'school-calendar',
  version: 1,
  model: MODEL_COMPLEX_LAYOUT,
  system: `あなたは日本の高校の年間行事予定表を読み取り、1 件ずつ構造化する係です。${NO_NAMES}`,
  schema: {
    type: 'object',
    required: ['fiscal_year', 'months', 'items'],
    properties: {
      fiscal_year: { type: 'integer', description: '西暦の年度（令和 8 年度 = 2026）' },
      months: { type: 'array', items: { type: 'string' }, description: '読み取った月 YYYY-MM' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['date', 'column', 'text'],
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            end_date: { type: ['string', 'null'], description: '縦矢印や「(～16日)」で期間が示されていれば最終日 YYYY-MM-DD' },
            column: { type: 'string', description: '列見出し。例: 生徒 / 学校・その他' },
            text: { type: 'string', description: 'セル内の 1 項目。複数項目が 1 セルにあれば項目ごとに分ける' },
            approximate: { type: 'boolean', description: '欄外・脚注など日付が近似なら true' },
          },
        },
      },
    },
  },
  render: (v, pages) =>
    [
      `この PDF ${pages ? `の ${pages[0]}〜${pages[1]} ページ` : ''}にある年間行事予定を、日付ごと・列ごとに全項目を抜き出してください。`,
      `年度は ${v.fiscalYear ?? '表の見出し'} です。4〜12 月はその年、1〜3 月は翌年の日付にしてください。`,
      '縦の矢印は開始日の項目がその矢印の終点まで続くことを示します。end_date に終点の日付を入れてください。点線の矢印も同じ扱いです。',
      '「中間考査(～16日)」のように括弧で終了日が書かれていれば end_date に反映してください。',
      '1 セルに複数の項目（改行や全角スペース区切り）があれば、項目ごとに別の item にしてください。',
      '「南:」で始まる項目はそのまま text に残してください（南校舎の予定）。',
      '表の欄外（月の下の脚注）にある項目は approximate: true とし、日付は読み取れる範囲で入れてください。',
      '空欄の日は出力しないでください。',
    ].join('\n'),
};

/** 部活の月間予定表（日 × カテゴリ列。横結合セル = 全カテゴリ共通） */
export interface ClubTableCell {
  date: string;
  /** 縦の矢印や「(～5日)」で期間が示されていれば最終日 */
  end_date?: string | null;
  category: string;
  text: string;
  place?: string | null;
  /** 横結合で複数カテゴリにまたがるセルは、各カテゴリに複製した上で true */
  merged?: boolean;
  /** 赤字などで強調されていたら true（版の変更点の目印。頼りにはしない） */
  highlighted?: boolean;
}
export interface ClubTableResult {
  title: string;
  year: number;
  month: number;
  categories: string[];
  cells: ClubTableCell[];
  /** 表の外の注記 */
  notes?: string[];
}

export const CLUB_TABLE_PROMPT: Prompt<ClubTableResult> = {
  id: 'club-table',
  version: 2,
  model: MODEL_COMPLEX_LAYOUT,
  system: `あなたは部活動の月間予定表（日付 × カテゴリの表）を読み取り、セル単位で構造化する係です。${NO_NAMES}`,
  schema: {
    type: 'object',
    required: ['title', 'year', 'month', 'categories', 'cells'],
    properties: {
      title: { type: 'string' },
      year: { type: 'integer', description: '西暦。表に年が無ければ曜日から推定した年' },
      month: { type: 'integer' },
      categories: { type: 'array', items: { type: 'string' }, description: '列見出しの順。場所列は含めない' },
      cells: {
        type: 'array',
        items: {
          type: 'object',
          required: ['date', 'category', 'text'],
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            end_date: { type: ['string', 'null'], description: '縦の矢印・縦線や「(～5日)」「8/3~5」で複数日にわたることが示されていれば最終日 YYYY-MM-DD。単日なら null' },
            category: { type: 'string' },
            text: { type: 'string', description: 'セルの本文 1 項目。場所列の値は含めない。改行で複数の項目があれば項目ごとに別の cell にする' },
            place: { type: ['string', 'null'], description: '隣の場所列の値' },
            merged: { type: 'boolean' },
            highlighted: { type: 'boolean' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
  },
  render: (v) =>
    [
      `この予定表（${v.clubName ?? '部活動'}）を日付 × カテゴリのセル単位で全部抜き出してください。`,
      v.year ? `年は ${v.year} 年です。表に年が無くても ${v.year} として日付を作ってください。` : '表に年が無ければ、日付と曜日の組み合わせから年を推定してください。',
      v.categories ? `カテゴリ列は左から ${v.categories} です。` : '',
      '横に結合されたセル（大会日・OFF など）は、またがっている全カテゴリに同じ内容を複製し merged: true にしてください。',
      '各カテゴリ列の右隣にある「場所」列は place に入れ、text には含めないでください。',
      '左端の日付・曜日列を正とし、右端に別の曜日列があっても無視してください。',
      '赤字・太字・網掛けで強調されたセルは highlighted: true にしてください。',
      '縦の矢印や縦線、「(～5日)」「8/3~5」のように複数日にわたる予定は、開始日の cell に end_date として最終日を入れてください（途中の日には繰り返さない）。',
      '1 つのセルに改行や「・」で複数の項目があれば、項目ごとに別の cell にしてください。',
      '日付は必ず YYYY-MM-DD にしてください。表が年間予定（月ごとの列）でも、各項目を実際の日付に直してください。',
      '空欄のセルは出力しないでください。',
    ]
      .filter(Boolean)
      .join('\n'),
};
