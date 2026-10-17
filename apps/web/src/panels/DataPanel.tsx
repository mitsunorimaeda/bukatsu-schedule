import { useState } from 'react';
import { deleteWorkspace, leaveWorkspace } from '../api';
import { download, exportFileName, workspaceCsv, workspaceIcs, workspaceJson } from '../export';
import type { Workspace } from '../model';
import { Panel } from '../ui';

/** データの扱い: どこに・何を・誰が・いつまで。書き出しと全削除もここ */
export function DataPanel({ ws, onClose, onLeft }: { ws?: Workspace; onClose: () => void; onLeft?: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const n = ws?.calendars.reduce((a, c) => a + c.events.length, 0) ?? 0;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await f();
      onLeft?.();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Panel title="データの扱い" wide onClose={onClose}>
      <div className="howto">
        <p className="hint">予定表は学校の内部情報です。何を、どこに、誰が見られる形で置いているかをここに書きます。いつでも持ち出せて、いつでも消せます。</p>

        <h4>どこに保存されるか</h4>
        <ul>
          <li>予定のデータは、運営（ARCA）が管理する Supabase のデータベース（東京リージョン）に保存されます。</li>
          <li>アプリ本体と閲覧リンク・ICS の配信は Cloudflare Pages で動いています。Cloudflare にはアクセスログ（接続元など）が短期間残ります。</li>
          <li>取り込みに使った PDF・画像そのものは保存しません。読み取りが終わった時点で捨てられ、残るのは読み取った予定だけです。</li>
        </ul>

        <h4>保存するもの・しないもの</h4>
        <ul>
          <li>保存する: 予定表の名前と設定、カレンダーと班、予定（内容・日時・場所・備考・下書きかどうか）、取り込みの版と差分、メンバーのメールアドレスと権限、閲覧リンク。</li>
          <li>
            保存しない: <b>生徒の名前や連絡先</b>。入力欄にも読み取りにも生徒名を扱う場所はなく、PDF に書いてあっても予定には取り込みません（顧問の名前など大人の名前は予定の一部として残ることがあります）。
          </li>
        </ul>

        <h4>誰が見られるか</h4>
        <ul>
          <li>メンバーは、その人の権限（管理者・先生・閲覧）とカレンダー・班ごとの編集権の範囲で見られます。</li>
          <li>閲覧リンク・ICS の URL を知っている人は、そのリンクに含めたカレンダー・班・期間の<b>公開済みの予定だけ</b>を見られます。下書きと確認待ちの取り込みは出ません。リンクは「共有・出力」からいつでも無効にできます。</li>
          <li>運営（ARCA）は、障害対応や不具合の調査のためにデータベースに触れる立場にあります。それ以外の目的で予定の内容を見たり、他に渡したりしません。</li>
        </ul>

        <h4>AI に送るもの</h4>
        <ul>
          <li>「PDF・シートを取り込む」で PDF や画像を読ませたときだけ、そのファイルの内容を Anthropic の Claude API に送ります。送るのは読み取りのためで、API に送ったデータはモデルの学習には使われません（Anthropic の商用 API の規約）。</li>
          <li>「自分の AI に読ませて貼り付ける」を選んだときは、PDF はこのアプリではなく、あなたが選んだ AI サービス（OpenAI・Google・Anthropic など）に、そのサービスの規約のもとで送られます。無料プランは入力を学習に使う設定が既定の場合があるので、設定を確認するか学校・職場のアカウントを使ってください。このアプリには貼り付けた結果だけが届きます。</li>
          <li>手で入力した予定、Google シート・CSV から読んだ予定、閲覧・共有の操作では AI には何も送りません。</li>
        </ul>

        <h4>いつまで残るか</h4>
        <ul>
          <li>消すまで残ります。カレンダーの削除や、下の「予定表を全削除」で、その場でデータベースから消えます。</li>
          <li>データベースの自動バックアップには、消したあとも一定期間（Supabase の設定で通常 7 日）残り、その後なくなります。</li>
          <li>ログインに使うアカウント（メールアドレス）は予定表とは別に管理されています。予定表を全削除してもアカウントは残ります。アカウント自体を消したいときは運営に連絡してください。</li>
        </ul>

        <h4>自分で立てて使う</h4>
        <p>このアプリは Supabase のプロジェクト 1 つと Cloudflare Pages 1 つで動く構成です。学校や自治体のアカウントで同じものを立てれば、データも AI の鍵も自分の管理下に置けます。手順はドキュメント（docs/data-handling.md）にあります。</p>

        {ws ? (
          <>
            <h4>持ち出す（書き出し）</h4>
            <p className="hint">この予定表の {ws.calendars.length} カレンダー・{n} 件。ブラウザの中で作るので、サーバーには何も送りません。</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => download(exportFileName(ws, 'json'), workspaceJson(ws), 'application/json')}>JSON（設定・下書き含む全部）</button>
              <button onClick={() => download(exportFileName(ws, 'csv'), workspaceCsv(ws), 'text/csv')}>CSV（Excel・シート用）</button>
              <button onClick={() => download(exportFileName(ws, 'ics'), workspaceIcs(ws), 'text/calendar')}>ICS（公開中の予定、カレンダーに取り込む用）</button>
            </div>

            {ws.role !== 'viewer' && (
              <>
                <h4>この予定表から抜ける</h4>
                <p className="hint">自分だけメンバーから外れます。予定表と他の人には影響しません。最後の管理者は抜けられません。</p>
                <button className="danger" disabled={busy} onClick={() => run(() => leaveWorkspace(ws.id))}>
                  メンバーから抜ける
                </button>
              </>
            )}

            {ws.role === 'admin' && (
              <>
                <h4>予定表を全削除</h4>
                <p className="hint">カレンダー・予定・取り込みの版・メンバー・閲覧リンクを全部消します。閲覧リンクと ICS はその場で見られなくなります。元に戻せません。先に上の JSON を保存しておくことをすすめます。</p>
                <label>
                  確認のため予定表の名前「{ws.name}」を入力
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={ws.name} />
                </label>
                <div style={{ marginTop: 8 }}>
                  <button className="danger" disabled={busy || confirm.trim() !== ws.name} onClick={() => run(() => deleteWorkspace(ws.id))}>
                    「{ws.name}」を全削除する
                  </button>
                </div>
              </>
            )}
            {err && <div className="error">{err}</div>}
          </>
        ) : (
          <p className="hint">書き出し（JSON・CSV・ICS）と全削除は、各予定表を開いて右上の「データ」から行えます。</p>
        )}
      </div>
    </Panel>
  );
}
