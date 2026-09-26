# schedule-bot

Discord で予定を管理し、前日 21 時にリマインドしてくれる Bot です。
[discordeno](https://github.com/discordeno/discordeno) + TypeScript 製。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/schedule create` | 予定名を入力 → 日付・時間・公開設定をメニューから選んで登録 |
| `/schedule view` | 「自分だけに表示」か「チャンネルに表示」を選んで予定を表示 |
| `/schedule edit 予定:` | 予定名や日付を入力すると候補が出る。選んで名前・日時・公開設定を変更 |
| `/schedule delete 予定:` | 同じく候補から選んで削除 (自分の予定のみ) |

操作画面はすべて本人にしか見えません。

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

## 今後の予定

- Google カレンダー連携 (OAuth)
