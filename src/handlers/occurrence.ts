// 繰り返し予定の操作: 全体を編集/削除するか、特定の日だけ休み・時間変更するか

import { randomUUID } from "node:crypto";

import { syncSchedule } from "../google/calendar.js";
import { listOccurrenceDays, repeatSummary } from "../recurrence.js";
import { getSchedules, type Schedule, shouldSkipNotification, updateSchedules } from "../store.js";
import { formatDate, nowLocal } from "../time.js";
import {
    button,
    ButtonStyle,
    type Interaction,
    row,
    scheduleDetail,
    select,
    type SelectOption,
} from "../ui.js";
import { startEdit } from "./panel.js";

const DRAFT_TTL_MS = 30 * 60 * 1000;

const expired = {
    content: "⌛ 操作の有効期限が切れました。もう一度コマンドを実行してください。",
    components: [],
};

const findOwn = async (id: string | undefined, userId: string) =>
    (await getSchedules()).find((s) => s.id === id && s.userId === userId);

// ---------------------------------------------------------------
// 削除の確認 (単発・繰り返し共通)
// ---------------------------------------------------------------

export const deleteConfirm = (s: Schedule) => ({
    content: `🗑️ **この予定を${s.repeat ? "すべて" : ""}削除しますか？**\n\n${scheduleDetail(s)}`,
    components: [
        row(
            button(`del:${s.id}:yes`, "削除する", ButtonStyle.Danger),
            button(`del:${s.id}:no`, "やめる"),
        ),
    ],
});

// ---------------------------------------------------------------
// 全体 or 特定の日 を選ぶメニュー
// ---------------------------------------------------------------

export const seriesMenu = (s: Schedule, action: "edit" | "delete") => ({
    content: `🔁 **${s.name}**（${repeatSummary(s)}）\n` +
        (action === "edit" ? "どちらを変更しますか？" : "どちらを削除しますか？"),
    components: [
        row(
            action === "edit"
                ? button(`ser:${s.id}:all`, "✏️ 全体を編集", ButtonStyle.Primary)
                : button(`ser:${s.id}:delete-all`, "🗑️ 繰り返しごと全部削除", ButtonStyle.Danger),
            button(
                `ser:${s.id}:day`,
                action === "edit" ? "📅 特定の日だけ変更" : "😴 特定の日だけ休みにする",
            ),
            button(`ser:${s.id}:cancel`, "キャンセル"),
        ),
    ],
});

export const onSeriesButton = async (interaction: Interaction) => {
    const [, id, action] = String(interaction.data.customId).split(":");
    const schedule = await findOwn(id, interaction.user.id.toString());

    if (action === "cancel") {
        await interaction.edit({ content: "キャンセルしました。", components: [] });
        return;
    }
    if (!schedule) {
        await interaction.edit({ content: "❌ 予定が見つかりませんでした。", components: [] });
        return;
    }

    if (action === "all") {
        await startEdit(interaction, schedule, true);
        return;
    }
    if (action === "delete-all") {
        await interaction.edit(deleteConfirm(schedule));
        return;
    }

    // 日付の選択
    const days = listOccurrenceDays(schedule);
    if (days.length === 0) {
        await interaction.edit({ content: "📅 これからの予定の日がありません。", components: [] });
        return;
    }
    const options: SelectOption[] = days.map((o) => {
        const option: SelectOption = { label: `${formatDate(o.date)} ${o.time}`, value: o.date };
        if (o.skipped) option.description = "休み";
        else if (o.changed) option.description = `時間変更 (通常 ${schedule.time})`;
        return option;
    });
    await interaction.edit({
        content: `🔁 **${schedule.name}**（${repeatSummary(schedule)}）\nどの日を変更しますか？`,
        components: [row(select(`day:${schedule.id}`, "日付を選択", options))],
    });
};

// ---------------------------------------------------------------
// 特定の日のパネル
// ---------------------------------------------------------------

interface DayDraft {
    id: string;
    userId: string;
    scheduleId: string;
    date: string;
    hour: string;
    minute: string;
    expiresAt: number;
    error?: string;
}

const dayDrafts = new Map<string, DayDraft>();

const cid = (id: string, action: string) => `occ:${id}:${action}`;

const renderDay = (d: DayDraft, s: Schedule) => {
    const r = s.repeat!;
    const skipped = r.skips.includes(d.date);
    const override = r.overrides[d.date];
    const current = skipped ? "休み" : override ? `${override} (時間変更中)` : `${s.time} (通常どおり)`;
    const chosen = `${d.hour}:${d.minute}`;

    const lines = [
        `📅 **${s.name} — ${formatDate(d.date)} だけ変更**`,
        `通常の時間：${s.time}`,
        `この日：${current}`,
        "",
        `時間を変えるときは下で選んで「${chosen} に変更」を押してください。`,
    ];
    if (d.error) lines.push("", `⚠️ ${d.error}`);

    const hourOptions: SelectOption[] = Array.from({ length: 24 }, (_, h) => {
        const hh = String(h).padStart(2, "0");
        return { label: `${hh}時`, value: hh, default: hh === d.hour };
    });
    const minuteOptions: SelectOption[] = Array.from({ length: 12 }, (_, i) => {
        const mm = String(i * 5).padStart(2, "0");
        return { label: `${mm}分`, value: mm, default: mm === d.minute };
    });

    const effective = skipped ? undefined : override ?? s.time;
    return {
        content: lines.join("\n"),
        components: [
            row(select(cid(d.id, "hour"), "時を選択", hourOptions)),
            row(select(cid(d.id, "minute"), "分を選択", minuteOptions)),
            row(
                button(cid(d.id, "time"), `💾 ${chosen} に変更`, ButtonStyle.Success, chosen === effective),
                button(cid(d.id, "skip"), "😴 この日は休み", ButtonStyle.Danger, skipped),
                button(cid(d.id, "restore"), "↩️ 通常に戻す", ButtonStyle.Secondary, !skipped && !override),
                button(cid(d.id, "cancel"), "キャンセル"),
            ),
        ],
    };
};

export const onDaySelect = async (interaction: Interaction) => {
    const scheduleId = String(interaction.data.customId).split(":")[1];
    const date = interaction.data.values?.[0];
    const userId = interaction.user.id.toString();
    const schedule = await findOwn(scheduleId, userId);

    if (!schedule?.repeat || !date) {
        await interaction.edit({ content: "❌ 予定が見つかりませんでした。", components: [] });
        return;
    }

    const now = Date.now();
    for (const [id, d] of dayDrafts) if (d.expiresAt < now) dayDrafts.delete(id);

    const time = schedule.repeat.overrides[date] ?? schedule.time;
    const [hour, minute] = time.split(":") as [string, string];
    const draft: DayDraft = {
        id: randomUUID(),
        userId,
        scheduleId: schedule.id,
        date,
        hour,
        minute,
        expiresAt: now + DRAFT_TTL_MS,
    };
    dayDrafts.set(draft.id, draft);
    await interaction.edit(renderDay(draft, schedule));
};

export const onDayPanel = async (interaction: Interaction) => {
    const [, draftId, action] = String(interaction.data.customId).split(":");
    const draft = draftId ? dayDrafts.get(draftId) : undefined;
    const userId = interaction.user.id.toString();

    if (!draft || draft.expiresAt < Date.now() || draft.userId !== userId) {
        await interaction.edit(expired);
        return;
    }
    draft.expiresAt = Date.now() + DRAFT_TTL_MS;
    delete draft.error;
    const value: string | undefined = interaction.data.values?.[0];

    if (action === "cancel") {
        dayDrafts.delete(draft.id);
        await interaction.edit({ content: "キャンセルしました。", components: [] });
        return;
    }
    if (action === "hour" || action === "minute") {
        if (value) draft[action] = value;
        const schedule = await findOwn(draft.scheduleId, userId);
        if (!schedule?.repeat) {
            await interaction.edit({ content: "❌ 予定が見つかりませんでした。", components: [] });
            return;
        }
        await interaction.edit(renderDay(draft, schedule));
        return;
    }

    const time = `${draft.hour}:${draft.minute}`;
    if (action === "time" && `${draft.date} ${time}` <= nowLocal().stamp) {
        draft.error = "その時間はすでに過ぎています。";
        const schedule = await findOwn(draft.scheduleId, userId);
        if (schedule?.repeat) await interaction.edit(renderDay(draft, schedule));
        return;
    }

    const result = await updateSchedules((list) => {
        const s = list.find((x) => x.id === draft.scheduleId && x.userId === userId);
        if (!s?.repeat) return undefined;
        const r = s.repeat;
        const d = draft.date;
        const removeSkip = () => (r.skips = r.skips.filter((x) => x !== d));

        if (action === "skip") {
            if (!r.skips.includes(d)) r.skips.push(d);
            delete r.overrides[d];
        } else {
            removeSkip();
            if (action === "time" && time !== s.time) r.overrides[d] = time;
            else delete r.overrides[d];
            // 時間が変わったので、通知時刻前ならもう一度通知する
            r.notifiedDates = r.notifiedDates.filter((x) => x !== d);
            if (shouldSkipNotification(d)) r.notifiedDates.push(d);
        }
        return { name: s.name, time: r.overrides[d] ?? s.time };
    });

    dayDrafts.delete(draft.id);
    if (result) void syncSchedule(userId, draft.scheduleId);
    if (!result) {
        await interaction.edit({ content: "❌ 予定が見つかりませんでした。", components: [] });
        return;
    }
    const day = formatDate(draft.date);
    await interaction.edit({
        content: action === "skip"
            ? `😴 ${day} の「${result.name}」を休みにしました。`
            : action === "time"
            ? `💾 ${day} の「${result.name}」を ${result.time} に変更しました。`
            : `↩️ ${day} の「${result.name}」を通常どおり (${result.time}) に戻しました。`,
        components: [],
    });
};
