import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseTimeRange, parsePlace, inferKind, DEFAULT_CLUB_KIND_RULES, DEFAULT_SCHOOL_KIND_RULES } from './normalize.js';
import { mergeSpans, expandSpans } from './merge.js';
import { buildIcs, foldLine } from './ics.js';
import { diffVersions, renderChangesMarkdown } from './diff.js';
import { eventUid } from './uid.js';
import { isNationalHolidayEvent, nationalHolidayName, nationalHolidays } from './holidays.js';
import type { ScheduleEventInput } from './types.js';

const base = { school: 'example', layer: 'club:track', layerType: 'club' as const, category: '全体' };

test('parseTimeRange: 業後 / 9時 / 範囲 / までに〜終わり', () => {
  assert.deepEqual(parseTimeRange('業後＠瑞若'), { start: '15:30' });
  assert.deepEqual(parseTimeRange('9時　瑞若'), { start: '09:00' });
  assert.deepEqual(parseTimeRange('練習 16:30～18:30'), { start: '16:30', end: '18:30' });
  assert.deepEqual(parseTimeRange('16:10までに練習場へ\n16:20までに卓球台を片付け\n18:30に終わり'), { start: '16:10', end: '18:30' });
  assert.deepEqual(parseTimeRange('練習 15:15 バス出発'), { start: '15:15', end: undefined });
  assert.deepEqual(parseTimeRange('OFF'), {});
  assert.deepEqual(parseTimeRange('16:10までに練習場へ\n└17:45-19:30指定ﾌｨｼﾞｶﾙ\n18:30に終わり'), { start: '16:10', end: '18:30' });
});

test('diffVersions: 期間の畳み方が違っても日単位で比較する', () => {
  const v1 = mergeSpans(normalize([
    { ...base, date: '2026-10-07', kind: 'off', title: 'OFF' },
    { ...base, date: '2026-10-08', kind: 'off', title: 'OFF' },
  ]));
  const v2 = mergeSpans(normalize([
    { ...base, date: '2026-10-07', kind: 'practice', title: '練習', timeStart: '16:15' },
    { ...base, date: '2026-10-08', kind: 'off', title: 'OFF' },
  ]));
  assert.equal(v1.length, 1, '畳まれている');
  const changes = diffVersions(v1, v2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].change, 'changed');
  assert.equal(changes[0].after?.date, '2026-10-07');
});

test('parsePlace', () => {
  assert.equal(parsePlace('業後＠瑞若'), '瑞若');
  assert.equal(parsePlace('9時　瑞若'), '瑞若');
  assert.equal(parsePlace('13時@瑞若'), '瑞若');
  assert.equal(parsePlace('業後'), undefined);
});

test('inferKind', () => {
  assert.equal(inferKind('OFF テスト勉強', DEFAULT_CLUB_KIND_RULES), 'pause:test');
  assert.equal(inferKind('OFF', DEFAULT_CLUB_KIND_RULES), 'off');
  assert.equal(inferKind('東海P⑭H vs 藤枝東 11:00キックオフ', DEFAULT_CLUB_KIND_RULES), 'match');
  assert.equal(inferKind('名古屋地区選手権(知多)', DEFAULT_CLUB_KIND_RULES), 'competition');
  assert.equal(inferKind('練習 15:15 バス出発', DEFAULT_CLUB_KIND_RULES), 'practice');
  assert.equal(inferKind('中間考査(～16日)', DEFAULT_SCHOOL_KIND_RULES, 'school_event'), 'exam');
  assert.equal(inferKind('愛知県民の日 学校ホリデー', DEFAULT_SCHOOL_KIND_RULES, 'school_event'), 'holiday');
  assert.equal(inferKind('先端科学技術入門⑫', DEFAULT_SCHOOL_KIND_RULES, 'school_event'), 'school_event');
});

test('normalize: 既定 120 分、終日種類は時刻を落とす、uid は内容に依存しない', () => {
  const ev = normalize([
    { ...base, date: '2026-10-01', kind: 'practice', title: '練習（業後）', timeStart: '15:30' },
    { ...base, date: '2026-10-03', kind: 'off', title: '休み', timeStart: '09:00' },
  ]);
  assert.equal(ev[0].timeEnd, '17:30');
  assert.equal(ev[1].timeStart, undefined);
  const a = eventUid({ ...base, date: '2026-10-01', kind: 'practice' });
  assert.equal(ev[0].uid, a);
  const changed = normalize([{ ...base, date: '2026-10-01', kind: 'practice', title: '練習 16:15', timeStart: '16:15' }]);
  assert.equal(changed[0].uid, a, '件名・時刻が変わっても uid は同じ');
});

test('normalize: 同日同種が 2 件なら seq で uid を分ける', () => {
  const ev = normalize([
    { ...base, layer: 'school', layerType: 'school', category: '生徒', date: '2026-10-01', kind: 'school_event', title: 'A' },
    { ...base, layer: 'school', layerType: 'school', category: '生徒', date: '2026-10-01', kind: 'school_event', title: 'B' },
  ]);
  assert.notEqual(ev[0].uid, ev[1].uid);
});

test('mergeSpans: 連続する考査を 1 件に、間が空けば別', () => {
  const inputs: ScheduleEventInput[] = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-05'].map((d) => ({
    ...base,
    date: d,
    kind: 'pause:test',
    title: 'テスト期間',
  }));
  const merged = mergeSpans(normalize(inputs));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].date, '2026-11-30');
  assert.equal(merged[0].endDate, '2026-12-03');
  assert.equal(merged[1].date, '2026-12-05');
  assert.equal(expandSpans(merged).length, 5);
});

test('mergeSpans: 練習（時刻あり）は畳まない', () => {
  const merged = mergeSpans(
    normalize([
      { ...base, date: '2026-10-01', kind: 'practice', title: '練習', timeStart: '15:30' },
      { ...base, date: '2026-10-02', kind: 'practice', title: '練習', timeStart: '15:30' },
    ]),
  );
  assert.equal(merged.length, 2);
});

test('buildIcs: 終日 / 時刻 / TRANSP / 折り返し / X- プロパティ', () => {
  const ev = mergeSpans(
    normalize([
      { ...base, date: '2026-10-01', kind: 'practice', title: '練習（業後）', timeStart: '15:30', place: '瑞若' },
      { ...base, date: '2026-10-05', kind: 'pause:test', title: 'テスト期間' },
      { ...base, date: '2026-10-06', kind: 'pause:test', title: 'テスト期間' },
    ]),
  );
  const ics = buildIcs(ev, { calendarName: '陸上部', version: 'v1', now: new Date('2026-10-17T00:00:00Z') });
  assert.match(ics, /DTSTART;TZID=Asia\/Tokyo:20261001T153000\r\nDTEND;TZID=Asia\/Tokyo:20261001T173000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261007\r\nTRANSP:TRANSPARENT/);
  assert.match(ics, /X-BUKATSU-KIND:pause:test/);
  assert.match(ics, /X-BUKATSU-VERSION:v1/);
  assert.match(ics, /LOCATION:瑞若/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `行が長い: ${line}`);
});

test('foldLine は UTF-8 の文字境界で折る', () => {
  const folded = foldLine('SUMMARY:' + 'あ'.repeat(60));
  const joined = folded.replace(/\r\n /g, '');
  assert.equal(joined, 'SUMMARY:' + 'あ'.repeat(60));
});

test('diffVersions: サッカー (2)→③ 型の差分', () => {
  const soccer = { school: 'example', layer: 'club:soccer', layerType: 'club' as const };
  const v2 = normalize([
    { ...soccer, category: 'セカンド', date: '2026-10-05', kind: 'practice', title: '練習 16:15 バス出発', timeStart: '16:15', place: '神領' },
    { ...soccer, category: 'セカンド', date: '2026-10-07', kind: 'off', title: 'OFF' },
    { ...soccer, category: 'トップ', date: '2026-10-21', kind: 'practice', title: '練習 15:15 バス出発', timeStart: '15:15', place: '神領' },
  ]);
  const v3 = normalize([
    { ...soccer, category: 'セカンド', date: '2026-10-05', kind: 'off', title: 'OFF' },
    { ...soccer, category: 'セカンド', date: '2026-10-07', kind: 'practice', title: '練習 16:15 バス出発', timeStart: '16:15', place: '神領' },
    { ...soccer, category: 'トップ', date: '2026-10-21', kind: 'practice', title: '練習 16:15 バス出発', timeStart: '16:15', place: '神領' },
    { ...soccer, category: '朝練', date: '2026-10-19', kind: 'practice', title: '希望者' },
  ]);
  const changes = diffVersions(v2, v3);
  // 10/5 練習→OFF と 10/7 OFF→練習 は種類が変わるが同じ (カテゴリ, 日) なので「変更」1 件ずつ、10/21 は変更、10/19 は追加
  assert.equal(changes.filter((c) => c.change === 'changed').length, 3);
  assert.equal(changes.filter((c) => c.change === 'added').length, 1);
  assert.equal(changes.filter((c) => c.change === 'removed').length, 0);
  assert.ok(changes.find((c) => c.change === 'changed' && c.after?.date === '2026-10-05')?.fields.includes('kind'));
  const md = renderChangesMarkdown(changes);
  assert.match(md, /【トップ】/);
  assert.match(md, /10\/21 練習 15:15 バス出発 15:15〜17:15｜神領 → 練習 16:15 バス出発 16:15〜18:15｜神領/);
});

test('nationalHolidays: 2026 年の祝日（振替休日・国民の休日を含む）', () => {
  const h = nationalHolidays(2026);
  assert.deepEqual(
    [...h.entries()].sort(),
    [
      ['2026-01-01', '元日'], ['2026-01-12', '成人の日'], ['2026-02-11', '建国記念の日'], ['2026-02-23', '天皇誕生日'], ['2026-03-20', '春分の日'],
      ['2026-04-29', '昭和の日'], ['2026-05-03', '憲法記念日'], ['2026-05-04', 'みどりの日'], ['2026-05-05', 'こどもの日'], ['2026-05-06', '振替休日'],
      ['2026-07-20', '海の日'], ['2026-08-11', '山の日'], ['2026-09-21', '敬老の日'], ['2026-09-22', '国民の休日'], ['2026-09-23', '秋分の日'],
      ['2026-10-12', 'スポーツの日'], ['2026-11-03', '文化の日'], ['2026-11-23', '勤労感謝の日'],
    ],
  );
  // 2027: 春分 3/21（日）→ 振替 3/22、秋分 9/23、敬老 9/20（国民の休日なし）
  assert.equal(nationalHolidayName('2027-03-22'), '振替休日');
  assert.equal(nationalHolidayName('2027-09-23'), '秋分の日');
  assert.equal(nationalHolidayName('2027-09-22'), undefined);
  assert.equal(nationalHolidayName('2026-10-18'), undefined);
});

test('isNationalHolidayEvent: 祝日そのものだけ true', () => {
  assert.equal(isNationalHolidayEvent({ date: '2026-07-20', title: '海の日' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-07-20', title: '海の日（祝）' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-07-20', title: '祝日' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-05-06', title: '振替休日' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-09-23', title: '秋分' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-10-12', title: 'スポーツの日' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-10-12', title: 'スポーツの日・休校' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-11-03', title: '文化の日 休校' }), true);
  assert.equal(isNationalHolidayEvent({ date: '2026-05-03', endDate: '2026-05-05', title: '祝日' }), true);
  // 祝日の日の別の予定は残す
  assert.equal(isNationalHolidayEvent({ date: '2026-11-03', title: '文化祭' }), false);
  assert.equal(isNationalHolidayEvent({ date: '2026-07-20', title: '練習試合 vs 〇〇' }), false);
  assert.equal(isNationalHolidayEvent({ date: '2026-07-20', title: '海の日 練習 9:00' }), false);
  // 祝日でない日の「休日」や学校独自の休みは残す
  assert.equal(isNationalHolidayEvent({ date: '2026-07-21', title: '休日' }), false);
  assert.equal(isNationalHolidayEvent({ date: '2026-06-01', title: '創立記念日' }), false);
  assert.equal(isNationalHolidayEvent({ date: '2026-05-01', endDate: '2026-05-06', title: '休み' }), false);
});

test('normalize: 国民の祝日は既定で落ち、設定で残せる', () => {
  const inputs: ScheduleEventInput[] = [
    { ...base, date: '2026-07-20', kind: 'holiday', title: '海の日' },
    { ...base, date: '2026-07-20', kind: 'match', title: '練習試合', timeStart: '09:00' },
    { ...base, date: '2026-06-01', kind: 'holiday', title: '創立記念日' },
  ];
  assert.deepEqual(normalize(inputs).map((e) => e.title), ['創立記念日', '練習試合']);
  assert.equal(normalize(inputs, { afterSchoolStart: '15:30', defaultDurationMin: 120, fiscalYearStartMonth: 4, skipNationalHolidays: false }).length, 3);
});
