// /schedule delete, /schedule edit の予定選択 (autocomplete) と削除処理

import { syncSchedule } from "../google/calendar.js";
import { expand, isActive, weekdaysLabel } from "../recurrence.js";
import { getSchedules, type Schedule, updateSchedules, upcomingFor } from "../store.js";
import { formatDate, nowLocal, parseUserDate } from "../time.js";
import { type Interaction, row, scheduleOption, select } from "../ui.js";
import { deleteConfirm, seriesMenu } from "./occurrence.js";
import { startEdit } from "./panel.js";

type Action = "delete" | "edit";

/**
 * 候補になる自分の予定。
 * 単発: 編集はこれからの予定だけ、削除は過去の予定も対象
 * 繰り返し: 終了日を過ぎていないもの (繰り返しが先頭)
 */
const candidates = async (userId: string, action: Action): Promise<Schedule[]> => {
    const all = (await getSchedules()).filter((s) => s.userId === userId);
    const repeats = all
        .filter((s) => s.repeat && (action === "delete" || isActive(s)))
        .sort((a, b) => a.name.localeCompare(b.name));
    const singles = action === "edit"
        ? upcomingFor(all, userId)
        : all
            .filter((s) => !s.repeat)
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return [...repeats, ...singles];
};

/** 予定名・日付・曜日のどれで入力しても当たるように判定する */
export const matchesQuery = (s: Schedule, query: string, today: string): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    const date = parseUserDate(q, today);

    if (s.repeat) {
        if (weekdaysLabel(s.repeat.weekdays).includes(q.replace(/曜日?/, ""))) return true;
        return date !== null && expand(s, date, date).length > 0;
    }

    if (formatDate(s.date).includes(q) || s.date.includes(q)) return true;
    if (date === s.date) return true;
    const digits = q.replace(/\D/g, "");
    return digits.length >= 3 && s.date.replace(/-/g, "").includes(digits);
};

// ---------------------------------------------------------------
// autocomplete
// ---------------------------------------------------------------

export const onAutocomplete = async (interaction: Interaction) => {
    const sub = interaction.data?.options?.[0];
    const action: Action = sub?.name === "edit" ? "edit" : "delete";
    const focused = sub?.options?.find((o: any) => o.focused);
    const query = String(focused?.value ?? "");
    const today = nowLocal().date;
    const userId = interaction.user.id.toString();

    const choices = (await candidates(userId, action))
        .filter((s) => matchesQuery(s, query, today))
        .slice(0, 25)
        .map((s) => {
            const opt = scheduleOption(s);
            return { name: opt.label, value: opt.value };
        });

    await interaction.respond({ choices });
};

// ---------------------------------------------------------------
// コマンド実行時: 入力値から予定を特定する
// ---------------------------------------------------------------

/** 1件に決まった予定について、次の画面を出す */
const proceed = async (
    interaction: Interaction,
    schedule: Schedule,
    action: Action,
    replace: boolean,
) => {
    if (schedule.repeat) {
        const menu = seriesMenu(schedule, action);
        if (replace) await interaction.edit(menu);
        else await interaction.respond(menu, { isPrivate: true });
        return;
    }
    if (action === "edit") {
        await startEdit(interaction, schedule, replace);
        return;
    }
    if (replace) await interaction.edit(deleteConfirm(schedule));
    else await interaction.respond(deleteConfirm(schedule), { isPrivate: true });
};

export const onManageCommand = async (interaction: Interaction, action: Action) => {
    const sub = interaction.data.options[0];
    const input = String(
        sub.options?.find((o: any) => o.name === "target")?.value ?? "",
    );
    const userId = interaction.user.id.toString();
    const list = await candidates(userId, action);

    // autocomplete から選んだ場合は value が予定の id になっている
    let matches = list.filter((s) => s.id === input);
    if (matches.length === 0) {
        const exact = list.filter((s) => s.name === input);
        matches = exact.length > 0
            ? exact
            : list.filter((s) => matchesQuery(s, input, nowLocal().date));
    }

    if (matches.length === 0) {
        const looksLikeId = /^[0-9a-f-]{36}$/.test(input);
        await interaction.respond(
            {
                content: looksLikeId
                    ? "❌ その予定は見つかりませんでした。"
                    : `❌ 「${input}」に当てはまるあなたの予定は見つかりませんでした。`,
            },
            { isPrivate: true },
        );
        return;
    }

    if (matches.length === 1) {
        await proceed(interaction, matches[0]!, action, false);
        return;
    }

    // 複数当てはまる → セレクトで選んでもらう
    await interaction.respond(
        {
            content: `「${input}」に当てはまる予定が ${matches.length} 件あります。` +
                `${action === "edit" ? "編集" : "削除"}する予定を選んでください。`,
            components: [
                row(select(`pick:${action}`, "予定を選択", matches.map(scheduleOption))),
            ],
        },
        { isPrivate: true },
    );
};

/** 複数候補のセレクトで選ばれたとき */
export const onPick = async (interaction: Interaction) => {
    const action: Action = interaction.data.customId === "pick:edit" ? "edit" : "delete";
    const id = interaction.data.values?.[0];
    const userId = interaction.user.id.toString();
    const schedule = (await getSchedules()).find((s) => s.id === id && s.userId === userId);

    if (!schedule) {
        await interaction.edit({ content: "❌ 予定が見つかりませんでした。", components: [] });
        return;
    }
    await proceed(interaction, schedule, action, true);
};

// ---------------------------------------------------------------
// 削除
// ---------------------------------------------------------------

export const onDeleteButton = async (interaction: Interaction) => {
    const [, id, answer] = String(interaction.data.customId).split(":");
    if (answer !== "yes") {
        await interaction.edit({ content: "削除をやめました。", components: [] });
        return;
    }

    const userId = interaction.user.id.toString();
    const removed = await updateSchedules((list) => {
        // 自分の予定しか消せない
        const index = list.findIndex((s) => s.id === id && s.userId === userId);
        return index === -1 ? undefined : list.splice(index, 1)[0];
    });
    if (removed) void syncSchedule(userId, removed.id);

    let content = "❌ 予定が見つかりませんでした。すでに削除されている可能性があります。";
    if (removed?.repeat) content = `🗑️ 繰り返しの予定「${removed.name}」を削除しました。`;
    else if (removed) {
        content = `🗑️ 「${removed.name}」(${formatDate(removed.date)} ${removed.time}) を削除しました。`;
    }
    await interaction.edit({ content, components: [] });
};
