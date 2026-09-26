// Google カレンダーへの同期 (Bot → Google) と、表示用の読み込み (Google → view)
//
// Bot が作ったイベントには extendedProperties.private に目印を付ける:
//   scheduleBotId   … Bot の予定の id
//   scheduleBotKind … "main" (予定本体) か "override:YYYY-MM-DD" (その日だけ時間変更した回)
// 予定が変わるたびに「目印の付いたイベント」を今の予定の内容にそろえるので、
// Google 側のイベント id を Bot で保存しておく必要がない。

import { config } from "../config.js";
import { expand } from "../recurrence.js";
import { getSchedules, type Schedule } from "../store.js";
import { addDays, addMinutes, nowLocal, tzOffset } from "../time.js";
import { getAccessToken } from "./oauth.js";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIMEOUT_MS = 10_000;
/** Bot の予定には終了時刻が無いので、Google には1時間の予定として登録する */
const DURATION_MINUTES = 60;
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export class GoogleApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

const api = async (
    token: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path = "",
    options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<any> => {
    const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
    const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const res = await fetch(`${API}${path}${query}`, init);

    if (method === "DELETE" && (res.status === 404 || res.status === 410)) return undefined;
    if (!res.ok) {
        const json: any = await res.json().catch(() => ({}));
        throw new GoogleApiError(json.error?.message ?? res.statusText, res.status);
    }
    return res.status === 204 ? undefined : res.json();
};

// ---------------------------------------------------------------
// Bot の予定 → Google のイベント
// ---------------------------------------------------------------

const dateTime = (date: string, time: string) => ({
    dateTime: `${date}T${time}:00`,
    timeZone: config.timeZone,
});

const timedEvent = (s: Schedule, date: string, time: string, kind: string) => {
    const end = addMinutes(date, time, DURATION_MINUTES);
    return {
        summary: s.name,
        description: "Schedule-bot で登録した予定です。変更は Discord の /schedule edit から行ってください。",
        start: dateTime(date, time),
        end: dateTime(end.date, end.time),
        extendedProperties: { private: { scheduleBotId: s.id, scheduleBotKind: kind } },
    };
};

/** RRULE の UNTIL は UTC で書く必要がある */
const untilUtc = (until: string): string =>
    new Date(`${until}T23:59:59${tzOffset(until, "23:59")}`)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");

/** 予定を表すべき Google イベントの一覧 (kind → イベント本文) */
export const buildEvents = (s: Schedule): Map<string, object> => {
    const events = new Map<string, object>();

    if (!s.repeat) {
        events.set("main", timedEvent(s, s.date, s.time, "main"));
        return events;
    }

    const r = s.repeat;
    const excludedSet = new Set([...r.skips, ...Object.keys(r.overrides)]);
    // 開始日以降で、休みでも時間変更でもない最初の回を繰り返しの1回目にする
    let first: string | undefined;
    for (let from = s.date; !first && from <= addDays(s.date, 366 * 2); from = addDays(from, 7)) {
        first = expand(s, from, addDays(from, 6), true).find((o) => !excludedSet.has(o.date))?.date;
    }

    if (first) {
        let rule = `RRULE:FREQ=WEEKLY;BYDAY=${r.weekdays.map((d) => BYDAY[d]).join(",")}`;
        if (r.until) rule += `;UNTIL=${untilUtc(r.until)}`;
        const recurrence = [rule];

        // 休みの日と時間変更した日は、本体の繰り返しからは除く
        const excluded = [...excludedSet]
            .filter((d) => d > first! && expand(s, d, d, true).length > 0)
            .sort();
        if (excluded.length > 0) {
            const t = s.time.replace(":", "");
            recurrence.push(
                `EXDATE;TZID=${config.timeZone}:${excluded.map((d) => `${d.replace(/-/g, "")}T${t}00`).join(",")}`,
            );
        }
        events.set("main", { ...timedEvent(s, first, s.time, "main"), recurrence });
    }

    // 時間変更した日は、別の単発イベントとして登録する
    for (const [date, time] of Object.entries(r.overrides)) {
        if (r.skips.includes(date) || expand(s, date, date, true).length === 0) continue;
        events.set(`override:${date}`, timedEvent(s, date, time, `override:${date}`));
    }
    return events;
};

const doSync = async (userId: string, scheduleId: string) => {
    const token = await getAccessToken(userId);
    if (!token) return; // 連携していない

    const schedule = (await getSchedules()).find((s) => s.id === scheduleId && s.userId === userId);
    const desired = schedule ? buildEvents(schedule) : new Map<string, object>();

    const existing: any[] = (await api(token, "GET", "", {
        query: {
            privateExtendedProperty: `scheduleBotId=${scheduleId}`,
            showDeleted: "false",
            maxResults: "250",
        },
    }))?.items ?? [];

    const done = new Set<string>();
    for (const event of existing) {
        const kind: string = event.extendedProperties?.private?.scheduleBotKind ?? "main";
        const body = desired.get(kind);
        if (body && !done.has(kind)) {
            await api(token, "PUT", `/${encodeURIComponent(event.id)}`, { body });
            done.add(kind);
        } else {
            await api(token, "DELETE", `/${encodeURIComponent(event.id)}`);
        }
    }
    for (const [kind, body] of desired) {
        if (!done.has(kind)) await api(token, "POST", "", { body });
    }
};

const syncQueues = new Map<string, Promise<void>>();

/**
 * 予定の今の状態を Google カレンダーに反映する (削除済みなら Google からも消す)。
 * 同じ予定への同期は順番に実行する。失敗しても Discord 側の操作には影響させない。
 */
export const syncSchedule = (userId: string, scheduleId: string): Promise<void> => {
    if (!config.google) return Promise.resolve();
    const prev = syncQueues.get(scheduleId) ?? Promise.resolve();
    const next = prev
        .then(() => doSync(userId, scheduleId))
        .catch((error) => console.error(`Google カレンダーへの同期に失敗しました (予定 ${scheduleId})`, error));
    syncQueues.set(scheduleId, next);
    void next.finally(() => {
        if (syncQueues.get(scheduleId) === next) syncQueues.delete(scheduleId);
    });
    return next;
};

/** 連携した直後に、その人のこれからの予定をまとめて Google に登録する */
export const syncAllFor = async (userId: string): Promise<void> => {
    const now = nowLocal();
    const targets = (await getSchedules()).filter((s) =>
        s.userId === userId &&
        (s.repeat ? !s.repeat.until || s.repeat.until >= now.date : `${s.date} ${s.time}` > now.stamp)
    );
    for (const s of targets) await syncSchedule(userId, s.id);
};

// ---------------------------------------------------------------
// Google → view (保存はせず、表示のたびに読む)
// ---------------------------------------------------------------

export interface GoogleEvent {
    date: string;
    /** "HH:MM" か、終日なら undefined */
    time?: string;
    title: string;
}

/**
 * from〜to (両端含む) にある Google の予定を返す。
 * この人が Bot で登録したイベントは除く (Bot の予定として別に表示されるため)。
 * 連携していなければ undefined。
 */
export const listGoogleEvents = async (
    userId: string,
    from: string,
    to: string,
): Promise<GoogleEvent[] | undefined> => {
    if (!config.google) return undefined;
    const token = await getAccessToken(userId);
    if (!token) return undefined;

    const end = addDays(to, 1);
    const json = await api(token, "GET", "", {
        query: {
            timeMin: `${from}T00:00:00${tzOffset(from, "00:00")}`,
            timeMax: `${end}T00:00:00${tzOffset(end, "00:00")}`,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "250",
        },
    });

    // 自分が Bot で作った予定は Bot の予定として別に表示されるので除く
    // (同じ Google アカウントを使うほかの Discord アカウントが作った予定は 📆 として表示する)
    const myIds = new Set((await getSchedules()).filter((s) => s.userId === userId).map((s) => s.id));

    const now = nowLocal();
    const result: GoogleEvent[] = [];
    for (const item of json?.items ?? []) {
        if (item.status === "cancelled") continue;
        if (myIds.has(item.extendedProperties?.private?.scheduleBotId)) continue;
        const title = String(item.summary ?? "(タイトルなし)");

        if (item.start?.dateTime) {
            const start = nowLocal(new Date(item.start.dateTime));
            if (start.stamp <= now.stamp || start.date < from || start.date > to) continue;
            result.push({ date: start.date, time: start.time, title });
        } else if (item.start?.date) {
            // 終日の予定。前から続いているものは、表示範囲の初日か今日に表示する
            let date: string = item.start.date < from ? from : item.start.date;
            if (date < now.date) {
                const endDate: string = item.end?.date ?? addDays(item.start.date, 1); // 終了日は含まない
                if (endDate <= now.date) continue;
                date = now.date;
            }
            if (date > to) continue;
            result.push({ date, title });
        }
    }
    return result;
};
