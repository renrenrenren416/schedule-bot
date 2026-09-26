// 日付は "YYYY-MM-DD"、時刻は "HH:MM" の文字列で扱う。
// どちらも config.timeZone (デフォルト Asia/Tokyo) の現地時刻として解釈する。
// 同じ形式同士なら文字列比較で前後関係がわかるので、Date の TZ 問題を避けられる。

import { config } from "./config.js";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

export interface LocalNow {
    date: string;
    time: string;
    /** "YYYY-MM-DD HH:MM" */
    stamp: string;
}

export const nowLocal = (at: Date = new Date()): LocalNow => {
    const parts = Object.fromEntries(
        formatter.formatToParts(at).map((p) => [p.type, p.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}`;
    return { date, time, stamp: `${date} ${time}` };
};

export const isValidDate = (date: string): boolean => {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    return (
        check.getUTCFullYear() === y &&
        check.getUTCMonth() === mo - 1 &&
        check.getUTCDate() === d
    );
};

export const isValidTime = (time: string): boolean => {
    const m = time.match(/^(\d{2}):(\d{2})$/);
    if (!m) return false;
    return Number(m[1]) <= 23 && Number(m[2]) <= 59;
};

/** "9:05" → "09:05" (旧データ用) */
export const normalizeTime = (time: string): string => {
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : time;
};

export const addDays = (date: string, days: number): string => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
};

export const weekday = (date: string): string => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
};

/** "2026-10-01" → "10/01(木)" */
export const formatDate = (date: string): string =>
    `${date.slice(5, 7)}/${date.slice(8, 10)}(${weekday(date)})`;

/** "2026-10-01" → "2026/10/01(木)" */
export const formatDateLong = (date: string): string =>
    `${date.slice(0, 4)}/${formatDate(date)}`;

/**
 * ユーザーが入力した日付をパースする。
 * 受け付ける形式: 2026-10-01 / 2026/10/1 / 10/1 / 10-1 / 1001 / 10月1日
 * 年を省略した場合、今日より前なら来年として扱う。
 */
export const parseUserDate = (input: string, today: string): string | null => {
    const s = input.trim().replace(/[０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    );

    let y: number | undefined;
    let m: number;
    let d: number;

    let match = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
    if (match) {
        [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = s.match(/^(\d{1,2})[-/月.](\d{1,2})日?$/))) {
        [m, d] = [Number(match[1]), Number(match[2])];
    } else if ((match = s.match(/^(\d{2})(\d{2})$/))) {
        [m, d] = [Number(match[1]), Number(match[2])];
    } else {
        return null;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const thisYear = Number(today.slice(0, 4));

    if (y === undefined) {
        const candidate = `${thisYear}-${pad(m)}-${pad(d)}`;
        y = candidate < today ? thisYear + 1 : thisYear;
    }

    const result = `${y}-${pad(m)}-${pad(d)}`;
    return isValidDate(result) ? result : null;
};

/** 予定の通知時刻 ("前日 HH:00") を "YYYY-MM-DD HH:MM" で返す */
export const notifyStamp = (date: string): string =>
    `${addDays(date, -1)} ${String(config.notifyHour).padStart(2, "0")}:00`;
