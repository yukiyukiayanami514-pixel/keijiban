# keijiban
AIチャット（ChatGPT風）＋ かんたん掲示板

## AIチャット（トップページ `/`）

ChatGPTのようにAIと会話できるページです。ログインは不要で、会話履歴は D1 データベースに保存されます。

- AI は **Cloudflare Workers AI**（モデル: `@cf/openai/gpt-oss-120b`）を使用。APIキーは不要です
- 会話履歴はブラウザごとに自動発行されるIDで区別されます（同じブラウザで開けば過去の会話が左側に表示されます）
- 左の「＋ 新しいチャット」で新しい会話、🗑 で会話を削除
- 回答は文字が少しずつ表示されます（ストリーミング）
- モデルを変えたいときは `src/chat.js` の `MODEL` を書き換えてください

## 掲示板（`/board`）

掲示板が1つだけあるシンプルなサイトです。誰かが書き込むと、開いている全員の画面に表示されます（3秒ごとに自動更新）。
Cloudflare Workers（サーバー）と Cloudflare D1（書き込みの保存先データベース）で動きます。

## 構成

- `src/worker.js` … 入口。掲示板の API（`/api/posts`）
- `src/chat.js` … AIチャットの API（`/api/chat`, `/api/conversations`）
- `public/index.html` … AIチャットの画面
- `public/board.html` … 掲示板の画面
- `schema.sql` … データベースのテーブル定義
- `wrangler.jsonc` … Cloudflare の設定（D1 データベース `keijiban` と Workers AI を使用）

※ 本番の D1 にテーブルがない場合は `npx wrangler d1 execute keijiban --remote --file=schema.sql` で作成できます。

## 公開（デプロイ）

Cloudflare ダッシュボード → Workers & Pages → 作成 → 「リポジトリをインポート」でこの GitHub リポジトリを選ぶと、
`wrangler.jsonc` の設定どおりに自動で公開されます。以降は GitHub にプッシュするたびに自動で更新されます。

コマンドで公開する場合:

```bash
npm install
npx wrangler login   # または CLOUDFLARE_API_TOKEN を設定
npm run deploy
```

## 手元で試す

```bash
npm install
npm run dev
```

※ Workers AI は手元でも Cloudflare 上で動くため、`npx wrangler login` が必要です。
