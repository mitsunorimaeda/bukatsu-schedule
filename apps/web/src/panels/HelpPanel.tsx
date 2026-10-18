import { Panel } from '../ui';

export function HelpPanel({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  return (
    <Panel title="使い方" wide onClose={onClose}>
      <div className="howto">
        <p className="hint">迷ったらこの順番です。画面の中でも順番に案内できます。</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <button className="primary" onClick={onTour}>
            画面の中で案内を見る
          </button>
        </div>
        <h4>基本の流れ</h4>
        <ol>
          <li>「＋ カレンダー」で部活や行事の単位を作る（班もここで）</li>
          <li>予定を入れる: 表のマスをクリック、または「PDF・シートを取り込む」</li>
          <li>「共有・出力」で、見せたい人に見せたい分だけリンク・ICS・PDF にする</li>
        </ol>
        <h4>使い方例</h4>
        <details open>
          <summary>サッカー部の顧問: いつもの Excel の予定表を配りたい</summary>
          <ol>
            <li>「＋ カレンダー」→ 名前「サッカー部」、班「トップ, サテライト, セカンド, 朝練」、入れ方は「PDF・写真を読ませる」</li>
            <li>いつも配っている PDF をドロップ。1〜2 分で表になるので、間違いがあればその場で直して「この版を反映」</li>
            <li>「共有・出力」→ サッカー部だけにチェック → 閲覧リンクを保護者の LINE グループに貼る。ICS の URL は選手に</li>
            <li>翌月の PDF ができたら、同じ手順で取り込むだけ。前の版との違いが色で出るので、変更点の連絡文もコピーできる</li>
          </ol>
        </details>
        <details>
          <summary>陸上部の顧問: 予定は Google シートで管理している</summary>
          <ol>
            <li>シートを「共有」→「リンクを知っている全員が閲覧可」にする（または「ファイル → 共有 → ウェブに公開」で CSV）</li>
            <li>「＋ カレンダー」→ 名前「陸上部」、入れ方は「Google シート / CSV をつなぐ」→ シートの URL を貼って「読み込んで列を選ぶ」</li>
            <li>先頭の数行を見ながら、日付の列と内容の列（必要なら時刻・場所・班）を選んで「作る」。選んだ列以外（選手名など）は保存されません</li>
            <li>シートを更新したら、カレンダーの ⚙ →「いま取り込む」→ 左の「確認して反映」。含まれる月だけが入れ替わります</li>
          </ol>
        </details>
        <details>
          <summary>教務の先生: 学校行事を全部活に共有したい</summary>
          <ol>
            <li>カレンダー「学校予定」に年間行事予定の PDF を取り込む（班は「生徒 / 学校」）</li>
            <li>各部の顧問をメンバーに招待し、それぞれの部のカレンダーだけ編集できるようにする</li>
            <li>先生方は学校予定と自分の部を重ねて見られる。考査期間は全部に自動で見える</li>
          </ol>
        </details>
        <details>
          <summary>保護者: 子どもの班の予定だけスマホに入れたい</summary>
          <ol>
            <li>顧問から届いた閲覧リンクを開く（ログイン不要）</li>
            <li>「カレンダーに追加」から、iPhone は URL をコピーして設定の「照会カレンダー」に、Android は Google カレンダーに追加</li>
            <li>予定が変わると自動で更新される。紙が欲しいときは PDF</li>
          </ol>
        </details>
        <details>
          <summary>家族・職場: 学校以外でも使える？</summary>
          <p style={{ margin: '4px 0' }}>使えます。「予定表を作る」で名前を付け、カレンダーを「父 / 母 / 子」や「営業 / 開発」のように作るだけです。</p>
        </details>
        <h4>よくある質問</h4>
        <details>
          <summary>あとから班を増やせる？</summary>
          <p style={{ margin: '4px 0' }}>カレンダー名の横の ⚙ か、表の見出しの「＋班」から。入っている予定はそのまま残ります。</p>
        </details>
        <details>
          <summary>まだ生徒に見せたくない予定は？</summary>
          <p style={{ margin: '4px 0' }}>マスの編集で「下書き」にチェック。先生だけに見え、リンク・ICS・PDF には出ません。カレンダー全体をまとめて出したいなら、設定で公開のしかたを「手動」にすると「公開する」を押すまで外に出ません。</p>
        </details>
        <details>
          <summary>PDF の読み取りにお金はかかる？</summary>
          <p style={{ margin: '4px 0' }}>1 枚あたり 20〜25 円です。読み取った結果は確認してから反映するので、誤読はその場で直せます。</p>
        </details>
        <details>
          <summary>自分の AI に読ませるとき、どの AI がいい？</summary>
          <p style={{ margin: '4px 0' }}>表の読み取りの正確さは AI とモードで差があります。日付の列と内容がずれる、期間が落ちるといったときは、別の AI か「じっくり考える」モードで試してください。取り込み画面の「読み方を表に合わせる」で表の形（縦に日付・月めくり・年間・一覧）と年を答えると、指示文がその表向けになります。結果は確認画面で直せます。</p>
        </details>
        <details>
          <summary>国民の祝日はどうなる？</summary>
          <p style={{ margin: '4px 0' }}>「海の日」「祝日」とだけ書かれたマスは取り込みません。スマホのカレンダーにはもともと祝日が入っていて、二重に出るためです。祝日の日の練習や行事、学校独自の休み（創立記念日など）はそのまま入ります。画面と PDF では祝日の日付が赤くなり、PDF には祝日名も小さく出ます。取り込みたい場合は、取り込み画面の「国民の祝日は取り込まない」を外してください（管理者のみ）。</p>
        </details>
        <details>
          <summary>生徒の名前は？</summary>
          <p style={{ margin: '4px 0' }}>取り込みません。名簿や当番表が載った PDF でも、氏名は読み飛ばします。</p>
        </details>
        <details>
          <summary>予定が変わったとき、見ている人にどう伝わる？</summary>
          <p style={{ margin: '4px 0' }}>リンクと ICS は自動で更新されます。あわせて「変更一覧」から通知文をコピーして LINE などに貼れます。</p>
        </details>
        <details>
          <summary>Bekuta との関係は？</summary>
          <p style={{ margin: '4px 0' }}>部ごとの ICS URL を Bekuta に登録すると、練習日と休止期間（考査）が取り込まれます。Bekuta を使っていなくてもこのツールは使えます。</p>
        </details>
      </div>
    </Panel>
  );
}
