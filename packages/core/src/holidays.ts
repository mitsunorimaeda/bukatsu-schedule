/**
 * 国民の祝日（日本）。法律の規則から計算するので年ごとの表は持たない。
 * 有効範囲は 2022〜2099 年（2020・2021 年の五輪に伴う移動、2019 年以前の制度変更は扱わない。
 * 春分・秋分は近似式で、この範囲では官報の確定日と一致する）。
 */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const nthMonday = (y: number, m: number, n: number) => {
  const first = dow(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
};
const addDay = (s: string, n: number) => {
  const t = new Date(`${s}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const cache = new Map<number, Map<string, string>>();

/** その年の国民の祝日。日付（YYYY-MM-DD）→ 名前。振替休日・国民の休日を含む */
export function nationalHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const y = year;
  const base: [number, number, string][] = [
    [1, 1, '元日'],
    [1, nthMonday(y, 1, 2), '成人の日'],
    [2, 11, '建国記念の日'],
    [2, 23, '天皇誕生日'],
    [3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '春分の日'],
    [4, 29, '昭和の日'],
    [5, 3, '憲法記念日'],
    [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'],
    [7, nthMonday(y, 7, 3), '海の日'],
    [8, 11, '山の日'],
    [9, nthMonday(y, 9, 3), '敬老の日'],
    [9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '秋分の日'],
    [10, nthMonday(y, 10, 2), 'スポーツの日'],
    [11, 3, '文化の日'],
    [11, 23, '勤労感謝の日'],
  ];
  const out = new Map<string, string>();
  for (const [m, d, name] of base) out.set(iso(y, m, d), name);
  // 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
  for (const [m, d] of base) {
    if (dow(y, m, d) !== 0) continue;
    let s = addDay(iso(y, m, d), 1);
    while (out.has(s)) s = addDay(s, 1);
    out.set(s, '振替休日');
  }
  // 国民の休日: 前日と翌日が祝日で、その日が日曜でも祝日でもない日（敬老の日と秋分の日の間など）
  for (const [m, d] of base) {
    const s = addDay(iso(y, m, d), 1);
    const n = addDay(s, 1);
    if (!out.has(s) && out.has(n) && new Date(`${s}T00:00:00Z`).getUTCDay() !== 0) out.set(s, '国民の休日');
  }
  cache.set(year, out);
  return out;
}

/** その日が国民の祝日なら名前、違えば undefined */
export function nationalHolidayName(date: string): string | undefined {
  const y = Number(date.slice(0, 4));
  if (!Number.isFinite(y) || y < 2022 || y > 2099) return undefined;
  return nationalHolidays(y).get(date);
}

/** 月（YYYY-MM）に含まれる祝日。日付 → 名前 */
export function nationalHolidaysInMonth(ym: string): Map<string, string> {
  const y = Number(ym.slice(0, 4));
  const out = new Map<string, string>();
  if (y < 2022 || y > 2099) return out;
  for (const [d, n] of nationalHolidays(y)) if (d.startsWith(ym)) out.set(d, n);
  return out;
}

/** 「祝日」「休日」「振休」など、祝日そのものを指すだけの語 */
const GENERIC = /^(祝日|祝|休日|休み|お休み|休校|休業日|振替休日|振休|国民の休日|holiday)$/i;

/** 括弧書き・記号・空白を落として中身だけにする（「海の日（祝）」→「海の日」） */
function core(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/[【】「」『』\[\]]/g, ' ')
    .replace(/[\s　・･、,/／:：\-–—―]+/g, '')
    .trim();
}

/**
 * 「国民の祝日そのもの」を表す予定か。
 * 条件: 期間内の全日が国民の祝日で、かつ内容が祝日名か「祝日」「休日」などの語だけ。
 * 祝日の日の別の予定（文化祭、練習試合）や、祝日でない日の「休日」は false。
 */
export function isNationalHolidayEvent(e: { date: string; endDate?: string; title?: string }): boolean {
  const names: string[] = [];
  let d = e.date;
  const end = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  for (let i = 0; i < 14 && d <= end; i++, d = addDay(d, 1)) {
    const n = nationalHolidayName(d);
    if (!n) return false;
    names.push(n);
  }
  if (d <= end) return false;
  const t = core(e.title ?? '');
  if (!t) return true;
  if (GENERIC.test(t)) return true;
  // 「海の日休校」「文化の日祝日」のように名前の後ろに休みの語が付いたものも祝日そのもの
  const t2 = t.replace(/(祝日|祝|休日|休校|休業日|休み|お休み)$/, '');
  const bare = (s: string) => s.replace(/の日$/, '');
  return names.some((n) => t2 === n || (bare(n).length >= 2 && t2 === bare(n)));
}
