// Discord のコンポーネントを組み立てる小さなヘルパー

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

export const select = (
    customId: string,
    placeholder: string,
    options: SelectOption[],
) => ({
    type: ComponentType.StringSelect,
    customId,
    placeholder,
    minValues: 1,
    maxValues: 1,
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
    },
) => ({
    title,
    customId,
    components: [
        row({
            type: ComponentType.TextInput,
            customId: "value",
            style: 1,
            required: true,
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

export const scheduleLine = (s: Schedule, showVisibility = true): string =>
    `• **${formatDate(s.date)} ${s.time}**　${s.name}` +
    (showVisibility ? `　${s.visibility === "private" ? "🔒" : "👥"}` : "");

export const scheduleDetail = (s: Schedule): string =>
    `予定名：${s.name}\n` +
    `日時：${formatDateLong(s.date)} ${s.time}\n` +
    `公開設定：${visibilityLabel(s.visibility)}`;

/** 予定の一覧を 2000 文字以内のテキストにする */
export const scheduleList = (
    header: string,
    list: readonly Schedule[],
    showVisibility = true,
): string => {
    let text = header;
    for (let i = 0; i < list.length; i++) {
        const line = `\n${scheduleLine(list[i]!, showVisibility)}`;
        if (text.length + line.length > 1900) {
            text += `\n…ほか ${list.length - i} 件`;
            break;
        }
        text += line;
    }
    return text;
};

/** 予定を選ぶセレクト用の選択肢 */
export const scheduleOption = (s: Schedule): SelectOption => ({
    label: `${formatDate(s.date)} ${s.time} ${s.name}`.slice(0, 100),
    value: s.id,
});
