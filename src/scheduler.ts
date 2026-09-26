// 前日 21:00 (NOTIFY_HOUR) の通知
//
// 1分ごとに「通知時刻を過ぎていて、まだ通知していない予定」を探して送る。
// 特定の時刻に1回だけ動かす方式と違い、Bot が落ちていた間の通知も再起動後に送られ、
// notified フラグで二重送信も防げる。
//
// - private の予定 → 本人に DM
//   (DM を受け取れない設定のときは、内容を伏せてチャンネルでメンション)
// - public の予定 → 作成したチャンネルでメンション
// - 繰り返し予定は、回ごとに前日 21:00 に通知する

import { expand } from "./recurrence.js";
import { getSchedules, type Schedule, updateSchedules } from "./store.js";
import { addDays, formatDateLong, type LocalNow, notifyStamp, nowLocal } from "./time.js";

const CHECK_INTERVAL_MS = 60 * 1000;
/** これより古い予定はデータから消す */
const KEEP_PAST_DAYS = 30;

type SendOptions = { content: string; allowedMentions?: { users?: string[]; parse?: string[] } };

/** 通知に必要な Bot の機能だけを抜き出した型 */
export interface NotifierBot {
    helpers: {
        getDmChannel(userId: string): Promise<{ id: bigint | string }>;
        sendMessage(channelId: bigint | string, options: SendOptions): Promise<unknown>;
    };
}

interface DueItem {
    schedule: Schedule;
    date: string;
    time: string;
    recurring: boolean;
}

const reminderText = (item: DueItem) =>
    `📅 **${item.date === nowLocal().date ? "今日" : "明日"}の予定のお知らせ**\n` +
    `予定：${item.schedule.name}${item.recurring ? "　🔁" : ""}\n` +
    `日時：${formatDateLong(item.date)} ${item.time}`;

/** 単発の予定が通知対象か */
export const isDue = (s: Schedule, nowStamp: string): boolean =>
    !s.notified &&
    nowStamp >= notifyStamp(s.date) &&
    `${s.date} ${s.time}` > nowStamp;

/** 今通知すべき回をすべて集める */
export const collectDue = (list: readonly Schedule[], now: LocalNow): DueItem[] =>
    list.flatMap((s): DueItem[] => {
        if (!s.repeat) {
            return isDue(s, now.stamp)
                ? [{ schedule: s, date: s.date, time: s.time, recurring: false }]
                : [];
        }
        const notified = s.repeat.notifiedDates;
        // 通知対象になりうるのは今日と明日の回だけ
        return expand(s, now.date, addDays(now.date, 1))
            .filter((o) =>
                !notified.includes(o.date) &&
                now.stamp >= notifyStamp(o.date) &&
                `${o.date} ${o.time}` > now.stamp
            )
            .map((o) => ({ schedule: s, date: o.date, time: o.time, recurring: true }));
    });

const sendReminder = async (bot: NotifierBot, item: DueItem) => {
    const s = item.schedule;
    const mention = { users: [s.userId] };

    if (s.visibility === "private") {
        try {
            const dm = await bot.helpers.getDmChannel(s.userId);
            await bot.helpers.sendMessage(dm.id, { content: reminderText(item) });
            return;
        } catch (error) {
            console.warn(`DM を送れませんでした (予定 ${s.id})`, error);
            if (!s.channelId) return;
            // 予定の内容は書かずに知らせる
            await bot.helpers.sendMessage(s.channelId, {
                content: `<@${s.userId}> 予定のリマインドを DM で送れませんでした。` +
                    `サーバーのプライバシー設定で「ダイレクトメッセージ」を許可してください。`,
                allowedMentions: mention,
            });
            return;
        }
    }

    if (!s.channelId) return;
    await bot.helpers.sendMessage(s.channelId, {
        content: `<@${s.userId}>\n${reminderText(item)}`,
        allowedMentions: mention,
    });
};

export const checkSchedules = async (bot: NotifierBot) => {
    const now = nowLocal();
    const due = collectDue(await getSchedules(), now);

    for (const item of due) {
        try {
            await sendReminder(bot, item);
        } catch (error) {
            // 送れなくても通知済みにする (毎分エラーを繰り返さないため)
            console.error(`通知の送信に失敗しました (予定 ${item.schedule.id})`, error);
        }
        await updateSchedules((list) => {
            const target = list.find((x) => x.id === item.schedule.id);
            if (!target) return;
            if (target.repeat) {
                if (!target.repeat.notifiedDates.includes(item.date)) {
                    target.repeat.notifiedDates.push(item.date);
                }
            } else {
                target.notified = true;
            }
        });
    }

    // 古いデータの掃除
    const cutoff = addDays(now.date, -KEEP_PAST_DAYS);
    const recent = addDays(now.date, -2);
    const isOld = (s: Schedule) =>
        s.repeat ? Boolean(s.repeat.until && s.repeat.until < cutoff) : s.date < cutoff;
    const hasStale = (s: Schedule) =>
        Boolean(s.repeat && (
            s.repeat.notifiedDates.some((d) => d < recent) ||
            s.repeat.skips.some((d) => d < cutoff) ||
            Object.keys(s.repeat.overrides).some((d) => d < cutoff)
        ));

    const current = await getSchedules();
    if (current.some((s) => isOld(s) || hasStale(s))) {
        await updateSchedules((list) => {
            const keep = list.filter((s) => !isOld(s));
            for (const s of keep) {
                if (!s.repeat) continue;
                const r = s.repeat;
                r.notifiedDates = r.notifiedDates.filter((d) => d >= recent);
                r.skips = r.skips.filter((d) => d >= cutoff);
                for (const d of Object.keys(r.overrides)) if (d < cutoff) delete r.overrides[d];
            }
            list.splice(0, list.length, ...keep);
        });
    }
};

export const startScheduler = (bot: NotifierBot) => {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await checkSchedules(bot);
        } catch (error) {
            console.error("通知チェック中にエラー:", error);
        } finally {
            running = false;
        }
    };
    void tick();
    setInterval(tick, CHECK_INTERVAL_MS);
};
