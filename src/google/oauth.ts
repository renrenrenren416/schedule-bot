// Google OAuth 2.0 (認可コードフロー)
//
// 1. /schedule google で、Discord ユーザーに紐づいた state 付きのログインURLを作る
// 2. ユーザーが Google でログイン・許可すると PUBLIC_URL/oauth/google/callback に戻ってくる
// 3. state から Discord ユーザーを特定し、認可コードをリフレッシュトークンに交換して保存

import { randomBytes } from "node:crypto";

import { config } from "../config.js";
import { getRefreshToken, isSharedWithOthers, removeToken, saveRefreshToken } from "./tokens.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** 予定の読み書きだけ (カレンダー自体の設定は触らない) */
export const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export class GoogleAuthError extends Error {}

const google = () => {
    if (!config.google) throw new GoogleAuthError("Google 連携が設定されていません");
    return config.google;
};

// ---------------------------------------------------------------
// state (CSRF 対策 + どの Discord ユーザーのログインかを覚える)
// ---------------------------------------------------------------

interface PendingLogin {
    userId: string;
    /** 連携完了時に「自分だけ」のメッセージを書き換えるためのトークン */
    interactionToken?: string;
    expiresAt: number;
}

const pending = new Map<string, PendingLogin>();

export const createAuthUrl = (userId: string, interactionToken?: string): string => {
    const now = Date.now();
    for (const [key, p] of pending) if (p.expiresAt < now) pending.delete(key);

    const state = randomBytes(24).toString("base64url");
    const entry: PendingLogin = { userId, expiresAt: now + STATE_TTL_MS };
    if (interactionToken) entry.interactionToken = interactionToken;
    pending.set(state, entry);

    const params = new URLSearchParams({
        client_id: google().clientId,
        redirect_uri: google().redirectUri,
        response_type: "code",
        // openid は、どの Google アカウントで連携したかを知るため
        scope: `openid ${SCOPE}`,
        access_type: "offline", // リフレッシュトークンをもらう
        prompt: "consent", // 2回目以降もリフレッシュトークンを必ずもらう
        include_granted_scopes: "true",
        state,
    });
    return `${AUTH_URL}?${params}`;
};

/** state を1回だけ使える形で取り出す */
export const consumeState = (state: string): PendingLogin | undefined => {
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry;
};

// ---------------------------------------------------------------
// トークン
// ---------------------------------------------------------------

const postForm = async (url: string, body: Record<string, string>) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
};

/**
 * id_token から Google アカウントの ID (sub) を取り出す。
 * トークンエンドポイントから直接 HTTPS で受け取ったものなので、署名の検証は省略する。
 */
const googleAccountOf = (idToken: unknown): string | undefined => {
    if (typeof idToken !== "string") return undefined;
    try {
        const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
        return typeof payload.sub === "string" ? payload.sub : undefined;
    } catch {
        return undefined;
    }
};

/** 認可コード → リフレッシュトークンを保存 */
export const exchangeCode = async (userId: string, code: string): Promise<void> => {
    const { ok, json } = await postForm(TOKEN_URL, {
        code,
        client_id: google().clientId,
        client_secret: google().clientSecret,
        redirect_uri: google().redirectUri,
        grant_type: "authorization_code",
    });
    if (!ok || !json.refresh_token) {
        throw new GoogleAuthError(`トークンの取得に失敗しました: ${json.error ?? "refresh_token なし"}`);
    }
    if (typeof json.scope === "string" && !json.scope.split(" ").includes(SCOPE)) {
        throw new GoogleAuthError("カレンダーへのアクセスが許可されませんでした");
    }
    await saveRefreshToken(userId, json.refresh_token, googleAccountOf(json.id_token));
    accessTokens.set(userId, {
        token: json.access_token,
        expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    });
};

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

/**
 * API 呼び出し用のアクセストークンを返す。連携していなければ undefined。
 * リフレッシュトークンが無効 (ユーザーが Google 側で許可を取り消した等) なら連携を解除する。
 */
export const getAccessToken = async (userId: string): Promise<string | undefined> => {
    const cached = accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const refreshToken = await getRefreshToken(userId);
    if (!refreshToken) return undefined;

    const { ok, json } = await postForm(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: google().clientId,
        client_secret: google().clientSecret,
        grant_type: "refresh_token",
    });
    if (!ok) {
        if (json.error === "invalid_grant") {
            console.warn(`Google の連携が無効になったため解除しました (user ${userId})`);
            await removeToken(userId);
            return undefined;
        }
        throw new GoogleAuthError(`アクセストークンの更新に失敗しました: ${json.error ?? "unknown"}`);
    }
    accessTokens.set(userId, {
        token: json.access_token,
        expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    });
    return json.access_token;
};

/**
 * 連携解除: Google 側の許可も取り消してから削除する。
 * Google は許可を Google アカウント単位で取り消すので、同じ Google アカウントを
 * ほかの Discord ユーザーも使っている場合は、Google 側の取り消しはしない。
 */
export const unlink = async (userId: string): Promise<void> => {
    const refreshToken = await getRefreshToken(userId);
    if (refreshToken && !(await isSharedWithOthers(userId))) {
        await postForm(REVOKE_URL, { token: refreshToken }).catch(() => {});
    }
    accessTokens.delete(userId);
    await removeToken(userId);
};
