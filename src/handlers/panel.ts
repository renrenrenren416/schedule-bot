// /schedule create と /schedule edit で共通の「予定入力パネル」
// 1つの ephemeral メッセージの中で日付・時・分・公開設定を選び、最後に保存する。

import { randomUUID } from "node:crypto";

import {
    newScheduleId,
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

interface Draft {
    id: string;
    userId: string;
    mode: "create" | "edit";
    scheduleId?: string;
    name: string;
    date?: string;
    hour?: string;
    minute: string;
    visibility: Visibility;
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

const validate = (d: Draft): string | undefined => {
    if (!d.date || !d.hour) return undefined; // 未入力はエラーではない
    const target = `${d.date} ${d.hour}:${d.minute}`;
    const now = nowLocal();
    if (target <= now.stamp) return "その日時はすでに過ぎています。";
    return undefined;
};

const render = (d: Draft) => {
    const today = nowLocal().date;
    const complete = Boolean(d.date && d.hour);
    const problem = validate(d);

    const title = d.mode === "create" ? "📝 **予定を作成**" : "✏️ **予定を編集**";
    const lines = [
        title,
        `予定名：${d.name}`,
        `日付：${d.date ? formatDateLong(d.date) : "未選択"}`,
        `時間：${d.hour ? `${d.hour}:${d.minute}` : "未選択"}`,
        `公開設定：${visibilityLabel(d.visibility)}`,
    ];
    const warning = d.error ?? problem;
    if (warning) lines.push("", `⚠️ ${warning}`);
    if (!complete) lines.push("", "下のメニューから日付と時間を選んでください。");

    // 日付: 今日から14日分 + (範囲外の日付が選ばれていればそれ) + 「その他」
    const dateOptions: SelectOption[] = [];
    if (d.date && (d.date < today || d.date > addDays(today, DATE_CHOICES - 1))) {
        dateOptions.push({ label: formatDate(d.date), value: d.date, default: true });
    }
    for (let i = 0; i < DATE_CHOICES; i++) {
        const date = addDays(today, i);
        const option: SelectOption = {
            label: formatDate(date),
            value: date,
            default: date === d.date,
        };
        if (i === 0) option.description = "今日";
        if (i === 1) option.description = "明日";
        dateOptions.push(option);
    }
    dateOptions.push({
        label: "📅 その他の日付を入力…",
        value: "other",
        description: "2週間より先の日付はこちら",
    });

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

    return {
        content: lines.join("\n"),
        components: [
            row(select(cid(d.id, "date"), "日付を選択", dateOptions)),
            row(select(cid(d.id, "hour"), "時を選択", hourOptions)),
            row(select(cid(d.id, "minute"), "分を選択", minuteOptions)),
            row(
                vis("private"),
                vis("public"),
                button(cid(d.id, "name"), "✏️ 名前を変更"),
            ),
            row(
                button(
                    cid(d.id, "save"),
                    d.mode === "create" ? "✅ 作成する" : "💾 保存する",
                    ButtonStyle.Success,
                    !complete || Boolean(problem),
                ),
                button(cid(d.id, "cancel"), "キャンセル", ButtonStyle.Danger),
            ),
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
        expiresAt: Date.now() + DRAFT_TTL_MS,
    };
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
    const value: string | undefined = interaction.data.values?.[0];

    switch (action) {
        case "date":
            if (value === "other") {
                const modal = textInputModal(cid(draft.id, "date-modal"), "日付を入力", {
                    label: "日付",
                    placeholder: "例：2026-12-24 / 12/24 / 12月24日",
                    maxLength: 20,
                    ...(draft.date ? { value: draft.date } : {}),
                });
                await interaction.respond(modal);
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

const save = async (interaction: Interaction, draft: Draft) => {
    const problem = validate(draft);
    if (!draft.date || !draft.hour || problem) {
        draft.error = problem ?? "日付と時間を選んでください。";
        await interaction.edit(render(draft));
        return;
    }
    const date = draft.date;
    const time = `${draft.hour}:${draft.minute}`;

    if (draft.mode === "create") {
        const schedule: Schedule = {
            id: newScheduleId(),
            userId: draft.userId,
            name: draft.name,
            date,
            time,
            visibility: draft.visibility,
            notified: shouldSkipNotification(date),
            createdAt: new Date().toISOString(),
        };
        if (draft.guildId) schedule.guildId = draft.guildId;
        if (draft.channelId) schedule.channelId = draft.channelId;

        await updateSchedules((list) => {
            list.push(schedule);
        });
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
        const dateTimeChanged = target.date !== date || target.time !== time;
        target.name = draft.name;
        target.date = date;
        target.time = time;
        target.visibility = draft.visibility;
        if (dateTimeChanged) target.notified = shouldSkipNotification(date);
        return { ...target };
    });

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
