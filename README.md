# keijiban
TESTかんたん掲示板

掲示板が1つだけあるシンプルなサイトです。誰かが書き込むと、開いている全員の画面に表示されます（3秒ごとに自動更新）。
Cloudflare Workers（サーバー）と Cloudflare D1（書き込みの保存先データベース）で動きます。

## 構成

- `src/worker.js` … 書き込みの受付・一覧を返す API（`/api/posts`）
- `public/index.html` … 掲示板の画面
- `schema.sql` … データベースのテーブル定義
- `wrangler.jsonc` … Cloudflare の設定（D1 データベース `keijiban` を使用）

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
