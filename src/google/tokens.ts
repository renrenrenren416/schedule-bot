// Google のリフレッシュトークンを AES-256-GCM で暗号化してファイルに保存する

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { config } from "../config.js";

interface StoredToken {
    /** iv.authTag.暗号文 (すべて base64) */
    refreshToken: string;
    /** Google アカウントの ID (同じ Google アカウントを複数の Discord アカウントで使っているかの判定用) */
    googleAccount?: string;
    linkedAt: string;
}

let cache: Record<string, StoredToken> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const key = (): Buffer => {
    if (!config.google) throw new Error("Google 連携が設定されていません");
    return config.google.encryptionKey;
};

export const encrypt = (plain: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};

export const decrypt = (packed: string): string => {
    const [iv, tag, data] = packed.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !data) throw new Error("トークンの形式が不正です");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};

const load = async (): Promise<Record<string, StoredToken>> => {
    if (cache) return cache;
    try {
        cache = JSON.parse(await readFile(config.tokenFile, "utf-8"));
    } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        cache = {};
    }
    return cache!;
};

const update = <T>(fn: (data: Record<string, StoredToken>) => T): Promise<T> => {
    const task = queue.then(async () => {
        const data = await load();
        const result = fn(data);
        await mkdir(dirname(config.tokenFile), { recursive: true });
        const tmp = `${config.tokenFile}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2));
        await rename(tmp, config.tokenFile);
        return result;
    });
    queue = task.catch(() => {});
    return task;
};

export const saveRefreshToken = (userId: string, refreshToken: string, googleAccount?: string) =>
    update((data) => {
        const entry: StoredToken = { refreshToken: encrypt(refreshToken), linkedAt: new Date().toISOString() };
        if (googleAccount) entry.googleAccount = googleAccount;
        data[userId] = entry;
    });

/** 同じ Google アカウントに連携している、ほかの Discord ユーザーがいるか */
export const isSharedWithOthers = async (userId: string): Promise<boolean> => {
    await queue;
    const data = await load();
    const account = data[userId]?.googleAccount;
    if (!account) return false;
    return Object.entries(data).some(([id, t]) => id !== userId && t.googleAccount === account);
};

export const getRefreshToken = async (userId: string): Promise<string | undefined> => {
    await queue;
    const stored = (await load())[userId];
    if (!stored) return undefined;
    try {
        return decrypt(stored.refreshToken);
    } catch {
        // 暗号化キーが変わった場合など。連携し直してもらう
        return undefined;
    }
};

export const isLinked = async (userId: string): Promise<boolean> =>
    Boolean(config.google) && (await getRefreshToken(userId)) !== undefined;

export const removeToken = (userId: string) =>
    update((data) => {
        delete data[userId];
    });
