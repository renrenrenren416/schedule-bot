import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { config } from "./config.js";
import { normalizeTime, nowLocal, notifyStamp } from "./time.js";

export type Visibility = "private" | "public";

export interface Schedule {
    id: string;
    userId: string;
    guildId?: string;
    channelId?: string;
    name: string;
    /** "YYYY-MM-DD" (config.timeZone の現地日付) */
    date: string;
    /** "HH:MM" */
    time: string;
    visibility: Visibility;
    notified: boolean;
    createdAt: string;
    /** Google カレンダー連携用 (未実装) */
    googleEventId?: string;
}

let cache: Schedule[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** 旧形式のデータ (id や visibility が無いもの) を補完する */
const normalize = (raw: any): Schedule => ({
    ...raw,
    id: raw.id ?? randomUUID(),
    userId: String(raw.userId),
    time: normalizeTime(String(raw.time)),
    visibility: raw.visibility === "public" ? "public" : "private",
    notified: Boolean(raw.notified),
    createdAt: raw.createdAt ?? new Date().toISOString(),
});

const load = async (): Promise<Schedule[]> => {
    if (cache) return cache;
    try {
        const text = await readFile(config.dataFile, "utf-8");
        const parsed = JSON.parse(text);
        cache = Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        cache = [];
    }
    return cache;
};

const save = async (list: Schedule[]): Promise<void> => {
    await mkdir(dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, config.dataFile);
};

/** 読み取り専用で全予定を取得する (返り値を書き換えないこと) */
export const getSchedules = async (): Promise<readonly Schedule[]> => {
    await queue;
    return load();
};

/**
 * 予定一覧を書き換える。書き込みは1つずつ順番に行われるので、
 * 同時に操作されてもデータが壊れない。
 */
export const updateSchedules = <T>(
    fn: (list: Schedule[]) => T | Promise<T>,
): Promise<T> => {
    const task = queue.then(async () => {
        const list = await load();
        const result = await fn(list);
        await save(list);
        return result;
    });
    queue = task.catch(() => {});
    return task;
};

/**
 * 通知時刻をすでに過ぎている予定 (前日21時以降に作った明日の予定など) は、
 * 作成直後に通知が飛ばないよう通知済み扱いにする。
 */
export const shouldSkipNotification = (date: string): boolean =>
    nowLocal().stamp >= notifyStamp(date);

export const newScheduleId = (): string => randomUUID();

/** 今日以降の自分の予定を日時順で返す */
export const upcomingFor = (
    list: readonly Schedule[],
    userId: string,
): Schedule[] => {
    const now = nowLocal().stamp;
    return list
        .filter((s) => s.userId === userId && `${s.date} ${s.time}` >= now)
        .sort((a, b) =>
            `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
        );
};
