// /schedule delete, /schedule edit の予定選択 (autocomplete) と削除処理

import { getSchedules, type Schedule, updateSchedules, upcomingFor } from "../store.js";
import { formatDate, nowLocal, parseUserDate } from "../time.js";
import {
    button,
    ButtonStyle,
    type Interaction,
    row,
    scheduleDetail,
    scheduleOption,
    select,
} from "../ui.js";
import { startEdit } from "./panel.js";

type Action = "delete" | "edit";

/** 削除は過去の予定も対象、編集はこれからの予定だけ */
const candidates = async (userId: string, action: Action): Promise<Schedule[]> => {
    const all = await getSchedules();
    if (action === "edit") return upcomingFor(all, userId);
    return all
        .filter((s) => s.userId === userId)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
};

/** 予定名・日付のどちらで入力しても当たるように判定する */
export const matchesQuery = (s: Schedule, query: string, today: string): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    if (formatDate(s.date).includes(q) || s.date.includes(q)) return true;
    if (parseUserDate(q, today) === s.date) return true;
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
        if (action === "edit") await startEdit(interaction, matches[0]!, false);
        else await interaction.respond(deleteConfirm(matches[0]!), { isPrivate: true });
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
    if (action === "edit") await startEdit(interaction, schedule, true);
    else await interaction.edit(deleteConfirm(schedule));
};

// ---------------------------------------------------------------
// 削除
// ---------------------------------------------------------------

const deleteConfirm = (s: Schedule) => ({
    content: `🗑️ **この予定を削除しますか？**\n\n${scheduleDetail(s)}`,
    components: [
        row(
            button(`del:${s.id}:yes`, "削除する", ButtonStyle.Danger),
            button(`del:${s.id}:no`, "やめる"),
        ),
    ],
});

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

    await interaction.edit({
        content: removed
            ? `🗑️ 「${removed.name}」(${formatDate(removed.date)} ${removed.time}) を削除しました。`
            : "❌ 予定が見つかりませんでした。すでに削除されている可能性があります。",
        components: [],
    });
};
