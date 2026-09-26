// 毎週の繰り返し予定を、日ごとの「回」に展開する処理

import type { Repeat, Schedule } from "./store.js";
import { addDays, formatDateLong, notifyStamp, nowLocal, weekday } from "./time.js";

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 予定の1回分 (単発の予定はそのまま1回、繰り返し予定は日ごとに1回) */
export interface Occurrence {
    schedule: Schedule;
    date: string;
    time: string;
    /** 繰り返し予定の回か */
    recurring: boolean;
    /** この日だけ時間変更されている */
    changed: boolean;
    /** この日は休み (listOccurrenceDays で休みも含めたときだけ true になりうる) */
    skipped: boolean;
}

export const weekdayOf = (date: string): number =>
    WEEKDAY_NAMES.indexOf(weekday(date) as (typeof WEEKDAY_NAMES)[number]);

export const weekdaysLabel = (weekdays: readonly number[]): string =>
    [...weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]).join("・");

/** "毎週 月・水・金 18:00" */
export const repeatSummary = (s: Schedule): string =>
    s.repeat ? `毎週 ${weekdaysLabel(s.repeat.weekdays)} ${s.time}` : "";

export const untilLabel = (r: Repeat): string =>
    r.until ? `${formatDateLong(r.until)} まで` : "終わりなし";

/**
 * from〜to (両端含む) の間の回を返す。
 * includeSkipped が true なら休みの日も skipped: true で含める。
 */
export const expand = (
    s: Schedule,
    from: string,
    to: string,
    includeSkipped = false,
): Occurrence[] => {
    if (!s.repeat) {
        if (s.date < from || s.date > to) return [];
        return [{ schedule: s, date: s.date, time: s.time, recurring: false, changed: false, skipped: false }];
    }

    const r = s.repeat;
    const start = s.date > from ? s.date : from;
    const end = r.until && r.until < to ? r.until : to;
    const result: Occurrence[] = [];

    for (let d = start; d <= end; d = addDays(d, 1)) {
        if (!r.weekdays.includes(weekdayOf(d))) continue;
        const skipped = r.skips.includes(d);
        if (skipped && !includeSkipped) continue;
        const override = r.overrides[d];
        result.push({
            schedule: s,
            date: d,
            time: override ?? s.time,
            recurring: true,
            changed: override !== undefined,
            skipped,
        });
    }
    return result;
};

const byDateTime = (a: Occurrence, b: Occurrence) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);

/**
 * これからの予定を回ごとに並べる。
 * 単発の予定はすべて、繰り返し予定は今日から days 日分を展開する。
 */
export const upcomingOccurrences = (
    list: readonly Schedule[],
    userId: string,
    days = 14,
): Occurrence[] => {
    const now = nowLocal();
    const far = "9999-12-31";
    return list
        .filter((s) => s.userId === userId)
        .flatMap((s) => expand(s, now.date, s.repeat ? addDays(now.date, days - 1) : far))
        .filter((o) => `${o.date} ${o.time}` > now.stamp)
        .sort(byDateTime);
};

/** 繰り返し予定のこれからの回 (休みも含む)。「この日だけ変更」の日付選択用 */
export const listOccurrenceDays = (s: Schedule, limit = 25): Occurrence[] => {
    const now = nowLocal();
    const result: Occurrence[] = [];
    // 最大1年先まで探す
    for (let week = 0; week < 53 && result.length < limit; week++) {
        const from = addDays(now.date, week * 7);
        const occ = expand(s, from, addDays(from, 6), true)
            .filter((o) => `${o.date} ${o.time}` > now.stamp);
        result.push(...occ);
    }
    return result.slice(0, limit);
};

/** 繰り返しがまだ続いているか (終了日を過ぎていないか) */
export const isActive = (s: Schedule): boolean =>
    !s.repeat || !s.repeat.until || s.repeat.until >= nowLocal().date;

/**
 * 繰り返し予定の、すでに通知時刻を過ぎている回を通知済みにする。
 * 作成・変更した直後に通知が飛ばないようにするため。
 */
export const markPastNotifications = (s: Schedule): void => {
    if (!s.repeat) return;
    const now = nowLocal();
    const soon = expand(s, now.date, addDays(now.date, 1));
    for (const o of soon) {
        if (now.stamp >= notifyStamp(o.date) && !s.repeat.notifiedDates.includes(o.date)) {
            s.repeat.notifiedDates.push(o.date);
        }
    }
};
