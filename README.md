# schedule-bot

Discord で予定を管理し、前日 21 時にリマインドしてくれる Bot です。
[discordeno](https://github.com/discordeno/discordeno) + TypeScript 製。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/schedule create` | 予定名を入力 → 日付・時間・公開設定をメニューから選んで登録。「🔁 繰り返し」で毎週の予定にもできる |
| `/schedule view` | 今月の予定を自分だけに表示。◀ ▶ やメニューで1年先まで月ごとに見られる。「この月をチャンネルに表示」で公開予定をチャンネルに出せる |
| `/schedule edit 予定:` | 予定名や日付を入力すると候補が出る。選んで名前・日時・公開設定を変更 |
| `/schedule delete 予定:` | 同じく候補から選んで削除 (自分の予定のみ) |
| `/schedule google` | Google カレンダーと連携 / 解除 |

操作画面はすべて本人にしか見えません。

### 毎週の繰り返し予定

バイトや授業など曜日が決まっている予定は、作成画面で「🔁 繰り返し」を ON にして
曜日 (複数選択可)・時間・終了日 (省略可) を選ぶと、1回の登録で毎週の予定になります。

`/schedule edit` で繰り返し予定を選ぶと、

- **全体を編集**: 曜日・時間・終了日などをまとめて変更
- **特定の日だけ変更**: その日だけ休みにする / 時間を変える / 通常に戻す

を選べます。`/schedule delete` では「繰り返しごと全部削除」か「特定の日だけ休み」を選べます。

### 公開設定

- 🔒 **自分だけ**: 前日 21 時に本人へ DM で通知。チャンネル表示には出ない
- 👥 **みんな**: 前日 21 時に予定を作ったチャンネルでメンション。チャンネル表示に出る

DM を受け取れない設定の場合は、予定の内容を伏せてチャンネルでお知らせします。

## セットアップ

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成し、Bot のトークンを取得
2. OAuth2 → URL Generator で `bot` と `applications.commands` を選び、
   Bot Permissions で `Send Messages` を付けてサーバーに招待
3. 依存関係をインストールして設定ファイルを作成

   ```bash
   npm install
   cp .env.example .env   # Windows: copy .env.example .env
   ```

4. `.env` に `DISCORD_TOKEN` を書く (開発中は `GUILD_ID` も書くとコマンドがすぐ反映される)
5. 起動

   ```bash
   npm start
   ```

予定は `src/data/schedules.json` に保存されます (Git には含まれません)。

## Google カレンダー連携 (任意)

`/schedule google` で各自が自分の Google アカウントを連携できます。

- Bot で登録・編集・削除した予定が Google カレンダーにも反映されます (1時間の予定として登録)
- `/schedule view` (自分だけ) に Google カレンダーの予定も 📆 付きで表示されます
  (チャンネルへの表示には出ません。通知の対象にもなりません)
- Google 側で直接編集した内容は Bot には反映されません

### 設定手順

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「API とサービス」→「ライブラリ」で **Google Calendar API** を有効にする
3. 「Google Auth Platform」(OAuth 同意画面) を設定
   - ユーザーの種類: **外部**
   - スコープ: `https://www.googleapis.com/auth/calendar.events`
   - テスト中は「テストユーザー」に連携する人の Gmail アドレスを追加 (最大100人)
4. 「クライアント」→「クライアントを作成」→ 種類 **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI に `PUBLIC_URL/oauth/google/callback` を追加
     (例: `http://localhost:3000/oauth/google/callback`)
5. `.env` に `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `PUBLIC_URL` `TOKEN_ENCRYPTION_KEY` を設定
   (`TOKEN_ENCRYPTION_KEY` の作り方は `.env.example` に書いてあります)

### 注意

- `PUBLIC_URL=http://localhost:3000` の場合、連携できるのは Bot を動かしている PC のブラウザからだけです。
  サーバーのみんなが連携するには、外からアクセスできる URL (VPS のドメインなど) が必要です。
- 同意画面が「テスト」状態のままだと、連携は **7日で切れます** (切れたら `/schedule google` でやり直し)。
  「本番環境」にすると切れなくなりますが、Google の審査を受けるまでは「確認されていないアプリ」の警告が出ます。
- トークンは `TOKEN_ENCRYPTION_KEY` で暗号化して `src/data/tokens.json` に保存します。
  この鍵を変えると全員の連携がやり直しになります。
