// 前日 21:00 (NOTIFY_HOUR) の通知
//
// 1分ごとに「通知時刻を過ぎていて、まだ通知していない予定」を探して送る。
// 特定の時刻に1回だけ動かす方式と違い、Bot が落ちていた間の通知も再起動後に送られ、
// notified フラグで二重送信も防げる。
//
// - private の予定 → 本人に DM
//   (DM を受け取れない設定のときは、内容を伏せてチャンネルでメンション)
// - public の予定 → 作成したチャンネルでメンション

import { getSchedules, type Schedule, updateSchedules } from "./store.js";
import { addDays, formatDateLong, notifyStamp, nowLocal } from "./time.js";

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

const reminderText = (s: Schedule) =>
    `📅 **${s.date === nowLocal().date ? "今日" : "明日"}の予定のお知らせ**\n` +
    `予定：${s.name}\n` +
    `日時：${formatDateLong(s.date)} ${s.time}`;

export const isDue = (s: Schedule, nowStamp: string): boolean =>
    !s.notified &&
    nowStamp >= notifyStamp(s.date) &&
    `${s.date} ${s.time}` > nowStamp;

const sendReminder = async (bot: NotifierBot, s: Schedule) => {
    const mention = { users: [s.userId] };

    if (s.visibility === "private") {
        try {
            const dm = await bot.helpers.getDmChannel(s.userId);
            await bot.helpers.sendMessage(dm.id, { content: reminderText(s) });
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
        content: `<@${s.userId}>\n${reminderText(s)}`,
        allowedMentions: mention,
    });
};

export const checkSchedules = async (bot: NotifierBot) => {
    const now = nowLocal();
    const due = (await getSchedules()).filter((s) => isDue(s, now.stamp));

    for (const s of due) {
        try {
            await sendReminder(bot, s);
        } catch (error) {
            // 送れなくても通知済みにする (毎分エラーを繰り返さないため)
            console.error(`通知の送信に失敗しました (予定 ${s.id})`, error);
        }
        await updateSchedules((list) => {
            const target = list.find((x) => x.id === s.id);
            if (target) target.notified = true;
        });
    }

    // 古い予定の掃除
    const cutoff = addDays(now.date, -KEEP_PAST_DAYS);
    if ((await getSchedules()).some((s) => s.date < cutoff)) {
        await updateSchedules((list) => {
            const keep = list.filter((s) => s.date >= cutoff);
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
