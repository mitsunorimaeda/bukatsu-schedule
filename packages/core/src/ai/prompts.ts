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
  '生徒・児童・会員など個人の氏名（名簿・当番表・個人の遠征先に書かれた人名）は出力に含めないでください。氏名が書かれたセルは、氏名を除いた残りの文だけを出力してください。' +
  '指導者の名前が活動内容の一部として書かれている場合（例: 「〇〇コーチ指導」）はそのまま残してください。' +
  '数字・英字・記号は半角に、全角スペースは半角に揃え、セル内の文言はそれ以外を書き換えずに写してください。';

/* ---------------- 読み取りの設定（画面の質問に対応。指示文の本文を組み立てる） ---------------- */

/** 表の形。画面で選ぶ */
export type ReadLayout = 'date-rows' | 'month-grid' | 'year-grid' | 'list' | 'week';
/** 場所の書かれ方 */
export type ReadPlace = 'none' | 'column' | 'inline';

export interface ReadOptions {
  /** 何の予定表か（「部活動」「学校行事」「施設の利用」など） */
  subject?: string;
  layout?: ReadLayout;
  /** 年（西暦）。年間予定なら年度（4 月始まり）。空なら AI に推定させる */
  year?: number;
  place?: ReadPlace;
  /** 区分（列）の一覧。1 つなら区分なしの表として読む */
  categories?: string[];
  /** 読み方の補足（自由文） */
  extra?: string;
}

export const READ_SUBJECTS: { id: string; label: string }[] = [
  { id: '部活動', label: '部活動（練習・大会）' },
  { id: '学校行事', label: '学校行事（年間・月間の行事予定）' },
  { id: '学年・クラス', label: '学年・クラスの予定' },
  { id: '施設の利用', label: '施設・コート・会場の利用予定' },
  { id: '勤務・当番', label: '職員の勤務・当番' },
];

export const READ_LAYOUTS: { id: ReadLayout; label: string; desc: string }[] = [
  { id: 'date-rows', label: '縦に日付、横に区分', desc: '1 日が 1 行。班・学年・列ごとの欄が横に並ぶ表' },
  { id: 'month-grid', label: '月めくりカレンダー', desc: '横に曜日が 7 列、日ごとのマスに予定が書いてある' },
  { id: 'year-grid', label: '年間予定', desc: '月ごとのブロックや月の列に日付が並ぶ（年間行事予定など）' },
  { id: 'list', label: '一覧・箇条書き', desc: '日付と内容が 1 行ずつ並ぶ' },
  { id: 'week', label: '週間予定', desc: '横に曜日、縦に時間帯や区分' },
];

export const READ_PLACES: { id: ReadPlace; label: string }[] = [
  { id: 'none', label: '場所の列は無い' },
  { id: 'column', label: '各区分の右隣に場所の列がある' },
  { id: 'inline', label: '本文の中に場所が書いてある（@体育館、（第2G）など）' },
];

/** 画面から来る文字列の variables を ReadOptions に */
export function readOptionsFromVars(v: Record<string, string>): ReadOptions {
  const year = v.year ? Number(v.year) : v.fiscalYear ? Number(v.fiscalYear) : undefined;
  const o: ReadOptions = {};
  if (v.subject) o.subject = v.subject;
  if (READ_LAYOUTS.some((l) => l.id === v.layout)) o.layout = v.layout as ReadLayout;
  if (year && year > 1900) o.year = year;
  if (READ_PLACES.some((p) => p.id === v.place)) o.place = v.place as ReadPlace;
  if (v.categories) o.categories = v.categories.split(/\s*[,、]\s*/).filter(Boolean);
  if (v.extra?.trim()) o.extra = v.extra.trim();
  return o;
}

/** ReadOptions を variables（文字列の辞書）に。画面 → サーバー、画面 → 指示文 の受け渡し用 */
export function readOptionsToVars(o: ReadOptions): Record<string, string> {
  const v: Record<string, string> = {};
  if (o.subject) v.subject = o.subject;
  if (o.layout) v.layout = o.layout;
  if (o.year) v.year = String(o.year);
  if (o.place) v.place = o.place;
  if (o.categories?.length) v.categories = o.categories.join(', ');
  if (o.extra) v.extra = o.extra;
  return v;
}

/**
 * 指示文の本文。部活の表でも学校の表でも同じ質問（何の表か・形・年・場所）から組み立てる。
 * names: 出力の呼び名（部活表 = cell / category、学校表 = item / column）
 */
export function renderReadInstructions(o: ReadOptions, names: { row: string; col: string }): string {
  const layout = o.layout ?? 'date-rows';
  const cats = o.categories ?? [];
  const multi = cats.length > 1;
  const yearIsFiscal = layout === 'year-grid';
  const lines: string[] = [];
  const layoutLabel = READ_LAYOUTS.find((l) => l.id === layout)?.label ?? '表';
  lines.push(`この予定表は${o.subject ? `「${o.subject}」の` : ''}予定表で、形は「${layoutLabel}」です。書かれている予定を 1 件ずつ全部抜き出してください。`);
  // 年
  if (o.year && yearIsFiscal) lines.push(`年度は ${o.year} 年度（4 月始まり）です。4〜12 月は ${o.year} 年、1〜3 月は ${o.year + 1} 年の日付にしてください。`);
  else if (o.year) lines.push(`年は ${o.year} 年です。表に年が無くても ${o.year} として日付を作ってください。`);
  else if (yearIsFiscal) lines.push('年度の年は表の見出しから読み、4〜12 月はその年、1〜3 月は翌年の日付にしてください。');
  else lines.push('表に年が無ければ、日付と曜日の組み合わせから年を推定してください。');
  // 表の形ごとの読み方
  if (layout === 'date-rows') {
    lines.push('1 日が 1 行で、横に区分（列）が並んでいます。各行の日付と、その行の各列の欄を 1 件ずつ出してください。');
    lines.push('横に結合されて複数の列にまたがるセル（大会日・OFF など）は、またがっている全部の列に同じ内容を複製し merged: true にしてください。');
    lines.push('日付・曜日の列が複数あれば左端を正としてください。');
  } else if (layout === 'month-grid') {
    lines.push('横に曜日が並ぶ月めくりのカレンダーです。マスの中の予定を 1 件ずつ出し、マスの日付を date にしてください。前月・翌月のマス（薄く書かれた日）は出さないでください。');
    lines.push('複数のマスにまたがる帯（期間の予定）は、開始日の 1 件に end_date として最終日を入れてください。');
  } else if (layout === 'year-grid') {
    lines.push('年間予定です。月ごとのブロック（または月の列）に日付が並んでいます。各項目を実際の日付 YYYY-MM-DD に直してください。');
    lines.push('縦の矢印や縦線（点線も）は、開始日の項目がその終点まで続くことを示します。');
    lines.push('表の欄外（月の下の脚注）にある項目は、日付が読み取れるものだけ出してください。');
  } else if (layout === 'list') {
    lines.push('日付と内容が 1 行ずつ並ぶ一覧です。1 行を 1 件として出してください。「4/1〜4/3」のように範囲で書かれていれば開始日を date、最終日を end_date にしてください。');
    lines.push('見出し行や区切り線は出さないでください。');
  } else if (layout === 'week') {
    lines.push('横に曜日が並ぶ週間予定です。表の見出しにある週の開始日から各曜日の日付を求め、各マスの予定を 1 件ずつ出してください。');
    lines.push('時間帯の行があれば、開始〜終了を本文の先頭に「9:00-10:30 」の形で付けてください。');
  }
  // 区分
  if (multi) {
    lines.push(`区分（${names.col}）は左から ${cats.join(', ')} です。表の見出しの表記が少し違っても、この中の最も近いものにそろえてください。この中に無い区分があれば、見出しのまま出してください。`);
  } else {
    lines.push(`区分は 1 つだけです。${names.col} には必ず「${cats[0] ?? '全体'}」と入れてください。`);
  }
  // 場所
  if (o.place === 'column') lines.push('各区分の右隣にある「場所」列は place に入れ、text には含めないでください。');
  else if (o.place === 'inline') lines.push('本文の中に書かれた場所（「@体育館」「（第2G）」「場所: 〇〇」など）は place に分け、text からは除いてください。');
  else lines.push('場所の列はありません。本文に場所が含まれていてもそのまま text に残してください。');
  // 共通
  lines.push('縦の矢印や縦線、「(～5日)」「8/3~5」のように複数日にわたる予定は、開始日の 1 件に end_date として最終日を入れてください（途中の日には繰り返さない）。');
  lines.push(`1 つのマスに改行や「・」で複数の項目があれば、項目ごとに別の ${names.row} にしてください。`);
  lines.push('赤字・太字・網掛けで強調されたマスは highlighted: true にしてください。');
  lines.push('日付は必ず YYYY-MM-DD にしてください。');
  lines.push('空欄のマスは出力しないでください。');
  if (o.extra) lines.push(`補足: ${o.extra}`);
  return lines.join('\n');
}

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
  version: 2,
  model: MODEL_COMPLEX_LAYOUT,
  system: `あなたは学校の行事予定表を読み取り、1 件ずつ構造化する係です。${NO_NAMES}`,
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
            merged: { type: 'boolean', description: '横結合で複数の列にまたがっていれば true' },
            highlighted: { type: 'boolean', description: '赤字・太字などで強調されていれば true' },
          },
        },
      },
    },
  },
  render: (v, pages) => {
    const o = readOptionsFromVars(v);
    return [
      pages ? `この PDF の ${pages[0]}〜${pages[1]} ページを読んでください。` : '',
      renderReadInstructions({ subject: '学校行事', layout: 'year-grid', categories: ['生徒', '学校・その他'], ...o }, { row: 'item', col: 'column' }),
      '表の欄外（月の下の脚注）にある項目は approximate: true にしてください。',
      '「〇〇:」のように校舎や学年の接頭辞が付いた項目は、接頭辞ごと text に残してください。',
    ]
      .filter(Boolean)
      .join('\n');
  },
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
  version: 3,
  model: MODEL_COMPLEX_LAYOUT,
  system: `あなたは予定表（日付ごとの予定が書かれた表やカレンダー）を読み取り、マス単位で構造化する係です。${NO_NAMES}`,
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
  render: (v) => renderReadInstructions(readOptionsFromVars(v), { row: 'cell', col: 'category' }),
};
