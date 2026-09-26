// Discord のコンポーネントを組み立てる小さなヘルパー

import { type Occurrence, repeatSummary, untilLabel, weekdaysLabel } from "./recurrence.js";
import type { Schedule, Visibility } from "./store.js";
import { formatDate, formatDateLong } from "./time.js";

/** discordeno の Interaction。desiredProperties で型が複雑になるので any で扱う */
export type Interaction = any;

export const ComponentType = {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
} as const;

export const ButtonStyle = {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
} as const;

export interface SelectOption {
    label: string;
    value: string;
    description?: string;
    default?: boolean;
}

export const row = (...components: object[]) => ({
    type: ComponentType.ActionRow,
    components,
});

export const button = (
    customId: string,
    label: string,
    style: number = ButtonStyle.Secondary,
    disabled = false,
) => ({ type: ComponentType.Button, customId, label, style, disabled });

/** URL を開くボタン */
export const linkButton = (url: string, label: string) => ({
    type: ComponentType.Button,
    style: 5,
    label,
    url,
});

export const select = (
    customId: string,
    placeholder: string,
    options: SelectOption[],
    maxValues = 1,
) => ({
    type: ComponentType.StringSelect,
    customId,
    placeholder,
    minValues: 1,
    maxValues: Math.min(maxValues, options.length, 25),
    options: options.slice(0, 25),
});

export const textInputModal = (
    customId: string,
    title: string,
    input: {
        label: string;
        placeholder?: string;
        value?: string;
        maxLength?: number;
        required?: boolean;
    },
) => ({
    title,
    customId,
    components: [
        row({
            type: ComponentType.TextInput,
            customId: "value",
            style: 1,
            required: input.required ?? true,
            label: input.label,
            maxLength: input.maxLength ?? 100,
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            ...(input.value ? { value: input.value } : {}),
        }),
    ],
});

/** モーダル送信から入力値を取り出す (ActionRow 形式と Label 形式の両方に対応) */
export const getModalValue = (
    interaction: Interaction,
    customId = "value",
): string | undefined => {
    const walk = (nodes: any[] | undefined): string | undefined => {
        for (const node of nodes ?? []) {
            if (node?.customId === customId && typeof node.value === "string") {
                return node.value;
            }
            const found = walk(node?.components) ??
                walk(node?.component ? [node.component] : undefined);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    return walk(interaction.data?.components);
};

export const visibilityLabel = (v: Visibility): string =>
    v === "private" ? "🔒 自分だけ" : "👥 みんな";

const visIcon = (s: Schedule) => (s.visibility === "private" ? "🔒" : "👥");

/** 一覧の1行 (1回分) */
export const occurrenceLine = (o: Occurrence, showVisibility = true): string =>
    `• **${formatDate(o.date)} ${o.time}**　${o.schedule.name}` +
    (o.recurring ? "　🔁" : "") +
    (o.changed ? "(時間変更)" : "") +
    (showVisibility ? `　${visIcon(o.schedule)}` : "");

/** 繰り返しルールの1行 */
export const repeatLine = (s: Schedule, showVisibility = true): string =>
    `• 🔁 **${repeatSummary(s)}**　${s.name}` +
    (s.repeat?.until ? `(${formatDate(s.repeat.until)} まで)` : "") +
    (showVisibility ? `　${visIcon(s)}` : "");

export const scheduleDetail = (s: Schedule): string => {
    if (s.repeat) {
        return `予定名：${s.name}\n` +
            `繰り返し：🔁 毎週 ${weekdaysLabel(s.repeat.weekdays)}\n` +
            `時間：${s.time}\n` +
            `期間：${formatDateLong(s.date)} から ${untilLabel(s.repeat)}\n` +
            `公開設定：${visibilityLabel(s.visibility)}`;
    }
    return `予定名：${s.name}\n` +
        `日時：${formatDateLong(s.date)} ${s.time}\n` +
        `公開設定：${visibilityLabel(s.visibility)}`;
};

/** 行の配列を 2000 文字以内のテキストにする */
export const joinLines = (header: string, lines: string[]): string => {
    let text = header;
    for (let i = 0; i < lines.length; i++) {
        const line = `\n${lines[i]}`;
        if (text.length + line.length > 1900) {
            text += `\n…ほか ${lines.length - i} 件`;
            break;
        }
        text += line;
    }
    return text;
};

/** 予定を選ぶセレクト / 自動補完用の選択肢 */
export const scheduleOption = (s: Schedule): SelectOption => ({
    label: (s.repeat
        ? `🔁 ${repeatSummary(s)} ${s.name}`
        : `${formatDate(s.date)} ${s.time} ${s.name}`).slice(0, 100),
    value: s.id,
});
