// Google のログイン後に戻ってくる先 (PUBLIC_URL/oauth/google/callback) を受ける Web サーバー

import { createServer } from "node:http";

import { config } from "./config.js";
import { syncAllFor } from "./google/calendar.js";
import { consumeState, exchangeCode } from "./google/oauth.js";

export interface ServerHooks {
    /** 連携が完了したときに呼ばれる (Discord のメッセージ更新など) */
    onLinked(userId: string, interactionToken?: string): Promise<void>;
}

const page = (title: string, message: string) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f5f7;color:#222}
main{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 2px 12px #0001;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 12px}p{margin:0;line-height:1.7;color:#555}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

export const startServer = (hooks: ServerHooks) => {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (status: number, title: string, message: string) => {
            res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
            res.end(page(title, message));
        };

        if (url.pathname !== "/oauth/google/callback") {
            if (url.pathname === "/") return send(200, "Schedule-bot", "動いています。");
            return send(404, "ページが見つかりません", "");
        }

        const state = url.searchParams.get("state") ?? "";
        const login = consumeState(state);
        if (!login) {
            return send(400, "リンクの有効期限が切れています", "Discord で /schedule google をもう一度実行してください。");
        }
        if (url.searchParams.get("error")) {
            return send(200, "連携をキャンセルしました", "このページは閉じて大丈夫です。");
        }
        const code = url.searchParams.get("code");
        if (!code) return send(400, "連携に失敗しました", "Discord で /schedule google をもう一度実行してください。");

        try {
            await exchangeCode(login.userId, code);
        } catch (error) {
            console.error("Google 連携に失敗しました", error);
            return send(500, "連携に失敗しました", "カレンダーへのアクセスを許可したか確認して、もう一度お試しください。");
        }

        send(200, "✅ Google カレンダーと連携しました", "このページを閉じて Discord に戻ってください。");

        // 画面は先に返し、Discord 側の更新とこれまでの予定の登録は後で行う
        try {
            await hooks.onLinked(login.userId, login.interactionToken);
            await syncAllFor(login.userId);
        } catch (error) {
            console.error("連携後の処理でエラー", error);
        }
    });

    server.listen(config.port, () => {
        console.log(`OAuth 用のサーバーを起動しました (port ${config.port})`);
        console.log(`Google Cloud に登録するリダイレクト URI: ${config.google?.redirectUri}`);
    });
    return server;
};
