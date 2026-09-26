// /schedule create と /schedule edit で共通の「予定入力パネル」
// 1つの ephemeral メッセージの中で日付(または曜日)・時・分・公開設定を選び、最後に保存する。

import { randomUUID } from "node:crypto";

import { syncSchedule } from "../google/calendar.js";
import { markPastNotifications, weekdaysLabel } from "../recurrence.js";
import {
    newScheduleId,
    type Repeat,
    type Schedule,
    shouldSkipNotification,
    updateSchedules,
    type Visibility,
} from "../store.js";
import {
    addDays,
    formatDate,
    formatDateLong,
    nowLocal,
    parseUserDate,
} from "../time.js";
import {
    button,
    ButtonStyle,
    getModalValue,
    type Interaction,
    row,
    scheduleDetail,
    select,
    type SelectOption,
    textInputModal,
    visibilityLabel,
} from "../ui.js";

const DATE_CHOICES = 14;
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_NAME_LENGTH = 100;
/** 月曜始まりで並べる */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_FULL = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

interface Draft {
    id: string;
    userId: string;
    mode: "create" | "edit";
    scheduleId?: string;
    name: string;
    /** 単発: 予定の日付 / 繰り返し: 開始日 */
    date?: string;
    hour?: string;
    minute: string;
    visibility: Visibility;
    /** 毎週の繰り返しにするか */
    repeat: boolean;
    weekdays: number[];
    until?: string;
    guildId?: string;
    channelId?: string;
    expiresAt: number;
    /** パネル上に一時的に出すエラー */
    error?: string;
}

const drafts = new Map<string, Draft>();

const cleanupDrafts = () => {
    const now = Date.now();
    for (const [id, d] of drafts) {
        if (d.expiresAt < now) drafts.delete(id);
    }
};

const cid = (draftId: string, action: string) => `panel:${draftId}:${action}`;

// ---------------------------------------------------------------
// 表示
// ---------------------------------------------------------------

const isComplete = (d: Draft): boolean =>
    Boolean(d.hour) && (d.repeat ? d.weekdays.length > 0 : Boolean(d.date));

const validate = (d: Draft): string | undefined => {
    if (!isComplete(d)) return undefined; // 未入力はエラーではない
    const now = nowLocal();
    if (d.repeat) {
        if (d.until && d.until < now.date) return "終了日が過去の日付になっています。";
        return undefined;
    }
    if (`${d.date} ${d.hour}:${d.minute}` <= now.stamp) return "その日時はすでに過ぎています。";
    return undefined;
};

const render = (d: Draft) => {
    const today = nowLocal().date;
    const complete = isComplete(d);
    const problem = validate(d);
    const time = d.hour ? `${d.hour}:${d.minute}` : "未選択";

    const lines = [
        d.mode === "create" ? "📝 **予定を作成**" : "✏️ **予定を編集**",
        `予定名：${d.name}`,
    ];
    if (d.repeat) {
        lines.push(
            `繰り返し：🔁 ${d.weekdays.length ? `毎週 ${weekdaysLabel(d.weekdays)}` : "曜日未選択"}`,
            `時間：${time}`,
            `終了日：${d.until ? `${formatDateLong(d.until)} まで` : "なし (ずっと繰り返す)"}`,
        );
    } else {
        lines.push(
            `日付：${d.date ? formatDateLong(d.date) : "未選択"}`,
            `時間：${time}`,
        );
    }
    lines.push(`公開設定：${visibilityLabel(d.visibility)}`);

    const warning = d.error ?? problem;
    if (warning) lines.push("", `⚠️ ${warning}`);
    if (!complete) {
        lines.push("", d.repeat
            ? "下のメニューから曜日 (複数選べます) と時間を選んでください。"
            : "下のメニューから日付と時間を選んでください。");
    }

    // 1段目: 日付 or 曜日
    let firstRow;
    if (d.repeat) {
        const options: SelectOption[] = WEEKDAY_ORDER.map((w) => ({
            label: WEEKDAY_FULL[w]!,
            value: String(w),
            default: d.weekdays.includes(w),
        }));
        firstRow = row(select(cid(d.id, "weekdays"), "曜日を選択 (複数可)", options, 7));
    } else {
        const options: SelectOption[] = [];
        if (d.date && (d.date < today || d.date > addDays(today, DATE_CHOICES - 1))) {
            options.push({ label: formatDate(d.date), value: d.date, default: true });
        }
        for (let i = 0; i < DATE_CHOICES; i++) {
            const date = addDays(today, i);
            const option: SelectOption = { label: formatDate(date), value: date, default: date === d.date };
            if (i === 0) option.description = "今日";
            if (i === 1) option.description = "明日";
            options.push(option);
        }
        options.push({
            label: "📅 その他の日付を入力…",
            value: "other",
            description: "2週間より先の日付はこちら",
        });
        firstRow = row(select(cid(d.id, "date"), "日付を選択", options));
    }

    const hourOptions: SelectOption[] = Array.from({ length: 24 }, (_, h) => {
        const hh = String(h).padStart(2, "0");
        return { label: `${hh}時`, value: hh, default: hh === d.hour };
    });

    const minuteOptions: SelectOption[] = Array.from({ length: 12 }, (_, i) => {
        const mm = String(i * 5).padStart(2, "0");
        return { label: `${mm}分`, value: mm, default: mm === d.minute };
    });

    const vis = (v: Visibility) =>
        button(
            cid(d.id, `vis-${v}`),
            visibilityLabel(v),
            d.visibility === v ? ButtonStyle.Primary : ButtonStyle.Secondary,
        );

    const bottom = [
        button(
            cid(d.id, "repeat"),
            d.repeat ? "🔁 繰り返し：ON" : "🔁 繰り返し：OFF",
            d.repeat ? ButtonStyle.Primary : ButtonStyle.Secondary,
        ),
    ];
    if (d.repeat) bottom.push(button(cid(d.id, "until"), "📅 終了日"));
    bottom.push(
        button(
            cid(d.id, "save"),
            d.mode === "create" ? "✅ 作成する" : "💾 保存する",
            ButtonStyle.Success,
            !complete || Boolean(problem),
        ),
        button(cid(d.id, "cancel"), "キャンセル", ButtonStyle.Danger),
    );

    return {
        content: lines.join("\n"),
        components: [
            firstRow,
            row(select(cid(d.id, "hour"), "時を選択", hourOptions)),
            row(select(cid(d.id, "minute"), "分を選択", minuteOptions)),
            row(vis("private"), vis("public"), button(cid(d.id, "name"), "✏️ 名前を変更")),
            row(...bottom),
        ],
    };
};

const expired = {
    content: "⌛ 操作の有効期限が切れました。もう一度コマンドを実行してください。",
    components: [],
};

// ---------------------------------------------------------------
// 開始
// ---------------------------------------------------------------

/** /schedule create: まず予定名を入力するモーダルを出す */
export const startCreate = async (interaction: Interaction) => {
    await interaction.respond(
        textInputModal("create-name", "予定を作成", {
            label: "予定名",
            placeholder: "例：バイト",
            maxLength: MAX_NAME_LENGTH,
        }),
    );
};

/** 予定名モーダルの送信 → パネルを自分だけに表示 */
export const onCreateNameSubmit = async (interaction: Interaction) => {
    cleanupDrafts();
    const name = getModalValue(interaction)?.trim();
    if (!name) {
        await interaction.respond({ content: "❌ 予定名を入力してください。" }, {
            isPrivate: true,
        });
        return;
    }

    const draft: Draft = {
        id: randomUUID(),
        userId: interaction.user.id.toString(),
        mode: "create",
        name,
        minute: "00",
        visibility: "private",
        repeat: false,
        weekdays: [],
        expiresAt: Date.now() + DRAFT_TTL_MS,
    };
    if (interaction.guildId) draft.guildId = interaction.guildId.toString();
    if (interaction.channelId) draft.channelId = interaction.channelId.toString();
    drafts.set(draft.id, draft);

    await interaction.respond(render(draft), { isPrivate: true });
};

/**
 * 既存の予定の編集パネルを作る。
 * `replace` が true ならボタン/セレクトを押したメッセージを書き換え、
 * false ならスラッシュコマンドへの返信として新しく表示する。
 */
export const startEdit = async (
    interaction: Interaction,
    schedule: Schedule,
    replace: boolean,
) => {
    cleanupDrafts();
    const [hour, minute] = schedule.time.split(":") as [string, string];
    const draft: Draft = {
        id: randomUUID(),
        userId: schedule.userId,
        mode: "edit",
        scheduleId: schedule.id,
        name: schedule.name,
        date: schedule.date,
        hour,
        minute,
        visibility: schedule.visibility,
        repeat: Boolean(schedule.repeat),
        weekdays: [...(schedule.repeat?.weekdays ?? [])],
        expiresAt: Date.now() + DRAFT_TTL_MS,
    };
    if (schedule.repeat?.until) draft.until = schedule.repeat.until;
    drafts.set(draft.id, draft);

    if (replace) await interaction.edit(render(draft));
    else await interaction.respond(render(draft), { isPrivate: true });
};

// ---------------------------------------------------------------
// パネル上の操作
// ---------------------------------------------------------------

/** customId が "panel:" で始まるコンポーネント/モーダルを処理する */
export const onPanelInteraction = async (interaction: Interaction) => {
    const [, draftId, action] = String(interaction.data.customId).split(":");
    const draft = draftId ? drafts.get(draftId) : undefined;
    const userId = interaction.user.id.toString();

    if (!draft || draft.expiresAt < Date.now()) {
        await interaction.edit(expired);
        return;
    }
    if (draft.userId !== userId) {
        await interaction.respond({ content: "❌ これはあなたの操作パネルではありません。" }, {
            isPrivate: true,
        });
        return;
    }

    draft.expiresAt = Date.now() + DRAFT_TTL_MS;
    delete draft.error;
    const values: string[] = interaction.data.values ?? [];
    const value = values[0];

    switch (action) {
        case "date":
            if (value === "other") {
                await interaction.respond(
                    textInputModal(cid(draft.id, "date-modal"), "日付を入力", {
                        label: "日付",
                        placeholder: "例：2026-12-24 / 12/24 / 12月24日",
                        maxLength: 20,
                        ...(draft.date ? { value: draft.date } : {}),
                    }),
                );
                return;
            }
            if (value) draft.date = value;
            break;

        case "date-modal": {
            const parsed = parseUserDate(getModalValue(interaction) ?? "", nowLocal().date);
            if (parsed) draft.date = parsed;
            else draft.error = "日付の形式が正しくありません。例：2026-12-24 / 12/24";
            break;
        }

        case "weekdays":
            draft.weekdays = values.map(Number).filter((n) => n >= 0 && n <= 6);
            break;

        case "repeat":
            draft.repeat = !draft.repeat;
            break;

        case "until":
            await interaction.respond(
                textInputModal(cid(draft.id, "until-modal"), "終了日を設定", {
                    label: "この日まで繰り返す (空欄なら終わりなし)",
                    placeholder: "例：2027-03-31 / 3/31",
                    maxLength: 20,
                    required: false,
                    ...(draft.until ? { value: draft.until } : {}),
                }),
            );
            return;

        case "until-modal": {
            const input = getModalValue(interaction)?.trim() ?? "";
            if (!input) {
                delete draft.until;
                break;
            }
            const parsed = parseUserDate(input, nowLocal().date);
            if (parsed) draft.until = parsed;
            else draft.error = "終了日の形式が正しくありません。例：2027-03-31 / 3/31";
            break;
        }

        case "hour":
            if (value) draft.hour = value;
            break;

        case "minute":
            if (value) draft.minute = value;
            break;

        case "vis-private":
            draft.visibility = "private";
            break;

        case "vis-public":
            draft.visibility = "public";
            break;

        case "name":
            await interaction.respond(
                textInputModal(cid(draft.id, "name-modal"), "予定名を変更", {
                    label: "予定名",
                    value: draft.name,
                    maxLength: MAX_NAME_LENGTH,
                }),
            );
            return;

        case "name-modal": {
            const name = getModalValue(interaction)?.trim();
            if (name) draft.name = name;
            break;
        }

        case "cancel":
            drafts.delete(draft.id);
            await interaction.edit({
                content: draft.mode === "create"
                    ? "予定の作成をキャンセルしました。"
                    : "編集をキャンセルしました。",
                components: [],
            });
            return;

        case "save":
            await save(interaction, draft);
            return;
    }

    await interaction.edit(render(draft));
};

const newRepeat = (d: Draft): Repeat => {
    const repeat: Repeat = {
        weekdays: [...d.weekdays].sort((a, b) => a - b),
        skips: [],
        overrides: {},
        notifiedDates: [],
    };
    if (d.until) repeat.until = d.until;
    return repeat;
};

const save = async (interaction: Interaction, draft: Draft) => {
    const problem = validate(draft);
    if (!isComplete(draft) || problem) {
        draft.error = problem ?? (draft.repeat ? "曜日と時間を選んでください。" : "日付と時間を選んでください。");
        await interaction.edit(render(draft));
        return;
    }
    const time = `${draft.hour}:${draft.minute}`;
    const today = nowLocal().date;

    if (draft.mode === "create") {
        const schedule: Schedule = {
            id: newScheduleId(),
            userId: draft.userId,
            name: draft.name,
            date: draft.repeat ? today : draft.date!,
            time,
            visibility: draft.visibility,
            notified: false,
            createdAt: new Date().toISOString(),
        };
        if (draft.repeat) {
            schedule.repeat = newRepeat(draft);
            markPastNotifications(schedule);
        } else {
            schedule.notified = shouldSkipNotification(schedule.date);
        }
        if (draft.guildId) schedule.guildId = draft.guildId;
        if (draft.channelId) schedule.channelId = draft.channelId;

        await updateSchedules((list) => {
            list.push(schedule);
        });
        void syncSchedule(schedule.userId, schedule.id);
        drafts.delete(draft.id);
        await interaction.edit({
            content: `✅ 予定を登録しました！\n\n${scheduleDetail(schedule)}`,
            components: [],
        });
        return;
    }

    const updated = await updateSchedules((list) => {
        const target = list.find(
            (s) => s.id === draft.scheduleId && s.userId === draft.userId,
        );
        if (!target) return undefined;

        target.name = draft.name;
        target.visibility = draft.visibility;

        if (draft.repeat) {
            if (!target.repeat) {
                // 単発 → 繰り返しに変更
                target.date = today;
                target.repeat = newRepeat(draft);
            } else {
                const r = target.repeat;
                const changed = target.time !== time ||
                    r.weekdays.join() !== [...draft.weekdays].sort((a, b) => a - b).join();
                r.weekdays = [...draft.weekdays].sort((a, b) => a - b);
                if (draft.until) r.until = draft.until;
                else delete r.until;
                // 曜日や時間が変わったら、これからの回はもう一度通知できるようにする
                if (changed) r.notifiedDates = [];
            }
            target.time = time;
            markPastNotifications(target);
        } else {
            const date = draft.date!;
            const changed = Boolean(target.repeat) || target.date !== date || target.time !== time;
            delete target.repeat;
            target.date = date;
            target.time = time;
            if (changed) target.notified = shouldSkipNotification(date);
        }
        return structuredClone(target);
    });

    if (updated) void syncSchedule(updated.userId, updated.id);
    drafts.delete(draft.id);
    await interaction.edit(
        updated
            ? {
                content: `💾 予定を更新しました！\n\n${scheduleDetail(updated)}`,
                components: [],
            }
            : { content: "❌ 予定が見つかりませんでした。削除された可能性があります。", components: [] },
    );
};
