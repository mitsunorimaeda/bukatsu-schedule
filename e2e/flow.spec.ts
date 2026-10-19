/**
 * 通しの流れ: ログイン → 予定表とカレンダーを作る → 予定を入れる（公開・下書き）→ 閲覧リンク → ICS → PDF（印刷画面）
 *  → 取り込み（自分の AI の返事を貼る）→ 反映 → AI 読み取りの上限 → 自動更新の警告 → カレンダーの削除
 * 1 本の流れなので順番に動かす（前の段の結果を次で使う）
 */
import { expect, test, type Page } from '@playwright/test';
import { loadState, rest } from './env';

test.describe.configure({ mode: 'serial' });

let page: Page;
const WS_NAME = `E2E 予定表 ${Date.now().toString(36)}`;
const CAL = 'E2Eサッカー部';
let wsId = '';
let token = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // 印刷ダイアログの代わりに呼ばれた回数を数える（印刷画面が自動で印刷を始めるかの確認）
  await page.context().addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed++;
    };
  });
});
test.afterAll(async () => {
  await page.close();
});

test('ログインして予定表を作る', async () => {
  const s = loadState()!;
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(s.email);
  await page.getByText('パスワードでログイン').click();
  await page.getByLabel('パスワード').fill(s.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('heading', { name: '予定表の一覧' })).toBeVisible();
  await page.getByRole('button', { name: '自分の予定表を作る' }).click();
  await page.getByPlaceholder('例: 〇〇高校、〇〇家、営業1課').fill(WS_NAME);
  await page.getByPlaceholder('例: 〇〇高校、〇〇家、営業1課').press('Enter');
  await expect(page).toHaveURL(/#ws\//);
  wsId = decodeURIComponent(page.url().split('#ws/')[1]);
  expect(wsId).not.toBe('');
});

/** 今月の d 日の行の、i 番目の班のマス */
const cell = (d: number, i: number) => page.locator('table.month tbody tr').nth(d - 1).locator('td.cell').nth(i);

test('カレンダーを作り、予定（公開・下書き）を入れる', async () => {
  await page.getByRole('button', { name: /カレンダーを作る/ }).click();
  await page.getByPlaceholder('例: サッカー部').fill(CAL);
  await page.getByPlaceholder('例: トップ, セカンド, 朝練').fill('トップ, セカンド');
  await page.getByText('この画面で直接書く').click();
  await page.getByRole('button', { name: '作る', exact: true }).click();
  await expect(page.locator('table.month thead')).toContainText(CAL);
  await expect(page.locator('table.month thead')).toContainText('セカンド');

  // 10 日のトップ: 公開される予定
  await cell(10, 0).click();
  await page.locator('#ed-title').fill('E2E練習 グラウンド');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(cell(10, 0)).toContainText('E2E練習');

  // 11 日のセカンド: 下書き（外に出ない）
  await cell(11, 1).click();
  await page.locator('#ed-title').fill('E2E下書きの予定');
  await page.getByText('下書き（仮の予定').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(cell(11, 1)).toContainText('E2E下書きの予定');
});

test('閲覧リンク: 公開した予定だけが見え、下書きは見えない', async () => {
  await page.getByRole('button', { name: '共有・出力' }).click();
  await page.getByPlaceholder('例: サッカー部 保護者向け').fill('E2E 保護者向け');
  await page.getByRole('button', { name: 'リンクを作る' }).click();
  const url = (await page.locator('.url span').first().textContent())!.trim();
  token = new URL(url).searchParams.get('token')!;
  expect(token).toMatch(/^[0-9a-f]{32,}$/);

  const viewer = await page.context().browser()!.newPage(); // ログインしていない別の人として開く
  await viewer.goto(`/?token=${token}`);
  await expect(viewer.locator('table.month')).toContainText('E2E練習');
  await expect(viewer.locator('table.month')).not.toContainText('E2E下書きの予定');
  await viewer.close();
});

test('ICS: 公開した予定が入り、下書きは入らない', async () => {
  const res = await page.request.get(`/ics/${token}.ics`);
  expect(res.ok()).toBeTruthy();
  const ics = await res.text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('E2E練習');
  expect(ics).not.toContain('E2E下書きの予定');
});

test('PDF: 1か月を1枚にして、印刷画面が開いて印刷が始まる', async () => {
  await page.locator('.tabs').getByRole('button', { name: 'PDF' }).click();
  const fit = page.locator('.pdfopts label').filter({ hasText: '1か月を1枚に収める' }).locator('input');
  if (!(await fit.isChecked())) await fit.check();
  await expect(page.locator('.panel .page').first()).toContainText('E2E練習');
  const [print] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'PDF を保存' }).click()]);
  // 既定の期間は今月と来月 → 1か月1枚で 2 ページ
  await expect(print.locator('.printview .page')).toHaveCount(2);
  await expect(print.locator('.printview .page').first()).toContainText('E2E練習');
  await expect(print.locator('.printview')).not.toContainText('E2E下書きの予定');
  await expect.poll(() => print.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBeGreaterThan(0);
  const size = await print.locator('.printview .page').first().evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
  expect(size).toEqual([1123, 794]); // A4 横の実寸
  await print.close();
  await page.keyboard.press('Escape');
});

/** 今月（日本時間）の YYYY-MM */
const ym = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

test('取り込み: 自分の AI の返事を貼る → 確認待ち → 反映', async () => {
  await page.getByRole('button', { name: 'PDF・シートを取り込む' }).click();
  await page.getByRole('button', { name: /自分の AI に読ませて貼り付ける/ }).click();
  const reply = { title: 'E2E', year: Number(ym.slice(0, 4)), month: Number(ym.slice(5)), categories: ['トップ', 'セカンド'], cells: [{ date: `${ym}-20`, end_date: null, category: 'トップ', text: 'E2E取り込み試合 10:00' }, { date: `${ym}-21`, end_date: null, category: 'セカンド', text: 'E2E取り込み練習' }] };
  await page.getByPlaceholder('{"title": ..., "cells": [ ... ]}').fill(JSON.stringify(reply));
  await page.getByRole('button', { name: '貼り付けた結果を読み込む' }).click();
  await expect(page.getByText(/確認待ち/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.pending').getByRole('button', { name: '確認して反映' }).click();
  await page.getByRole('button', { name: '反映する' }).click();
  await expect(page.locator('.pending')).toHaveCount(0);
  await expect(cell(20, 0)).toContainText('E2E取り込み試合');
  await expect(cell(21, 1)).toContainText('E2E取り込み練習');
});

/** ログイン中の利用者の JWT（画面と同じ鍵で API を叩くため） */
const accessToken = () =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
    return k ? (JSON.parse(localStorage.getItem(k)!) as { access_token: string }).access_token : '';
  });
const callImport = async () => {
  const calId = await calIdOf(CAL);
  return page.request.post('/api/import', {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    multipart: { schoolId: wsId, calendarId: calId, kind: 'club-table', file: { name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') } },
  });
};
const calIdOf = async (name: string) => {
  const r = await rest(`layers?school_id=eq.${encodeURIComponent(wsId)}&name=eq.${encodeURIComponent(name)}&select=id`);
  return ((await r.json()) as { id: string }[])[0].id;
};

test('AI 読み取りの上限: 上限に達すると画面で止まり、サーバーも Claude を呼ばずに断る', async () => {
  // 管理者が画面で上限を 0 円（使わない）にする
  await page.getByRole('button', { name: 'PDF・シートを取り込む' }).click();
  await page.getByRole('button', { name: /このアプリに読ませる/ }).click();
  const quota = page.locator('.aiquota');
  await expect(quota).toContainText('今月の AI 読み取り');
  await quota.locator('input[type=number]').fill('0');
  await quota.locator('input[type=number]').press('Enter');
  await expect(quota).toHaveClass(/over/);
  await expect(page.getByRole('button', { name: '読み取りを始める' })).toBeDisabled();
  let res = await callImport();
  expect(res.status()).toBe(429);
  expect((await res.json()).error).toContain('使わない設定');

  // 上限 100 円、今月すでに 150 円使っている → 断る
  await rest(`schools?id=eq.${encodeURIComponent(wsId)}`, { method: 'PATCH', body: JSON.stringify({ settings: { afterSchoolStart: '15:30', defaultDurationMin: 120, fiscalYearStartMonth: 4, skipNationalHolidays: true, aiMonthlyYen: 100 } }) });
  await rest('ai_usage', { method: 'POST', body: JSON.stringify({ school_id: wsId, model: 'e2e', input_tokens: 0, output_tokens: 0, cost_yen: 150 }) });
  res = await callImport();
  expect(res.status()).toBe(429);
  const body = (await res.json()) as { error: string; usedYen: number; limitYen: number };
  expect(body.error).toContain('上限（100 円）');
  expect(body.usedYen).toBe(150);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'PDF・シートを取り込む' }).click();
  await page.getByRole('button', { name: /このアプリに読ませる/ }).click();
  await expect(page.locator('.aiquota')).toContainText('約 150 円');
  await expect(page.locator('.aiquota')).toContainText('上限 100 円');
  await page.keyboard.press('Escape');
});

test('自動更新の警告: シートの取り込みが失敗・停止していると管理者に出る', async () => {
  const calId = await calIdOf(CAL);
  const base = { kind: 'sheet', url: 'https://example.com/e2e.csv', csvUrl: 'https://example.com/e2e.csv', mapping: { date: 0, title: 1, headerRows: 1 }, auto: 'apply' };
  const patch = (source: object) => rest(`layers?school_id=eq.${encodeURIComponent(wsId)}&id=eq.${encodeURIComponent(calId)}`, { method: 'PATCH', body: JSON.stringify({ source }) });

  await patch({ ...base, lastSync: new Date().toISOString(), lastError: 'HTTP 404' });
  await page.reload();
  await expect(page.locator('.alert.error')).toContainText(CAL);
  await expect(page.locator('.alert.error')).toContainText('HTTP 404');

  await patch({ ...base, lastSync: new Date(Date.now() - 5 * 3600_000).toISOString(), lastError: null });
  await page.reload();
  await expect(page.locator('.alert.stale')).toContainText('止まっている可能性');

  await patch({ ...base, lastSync: new Date().toISOString(), lastError: null });
  await page.reload();
  await expect(page.locator('.alert')).toHaveCount(0);
});

test('カレンダーの削除: 確認ボックスが画面内に出て、消える', async () => {
  await page.getByTitle('名前・色・班を変える').first().click();
  await page.getByRole('button', { name: 'カレンダーを削除' }).click();
  const confirm = page.getByRole('button', { name: '削除する', exact: true });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(page.getByText('まだカレンダーがありません')).toBeVisible();
});
