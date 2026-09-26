// /schedule view: 表示先 (自分だけ / チャンネル) を選んでから予定を出す

import { isActive, upcomingOccurrences } from "../recurrence.js";
import { getSchedules, type Schedule } from "../store.js";
import {
    button,
    ButtonStyle,
    type Interaction,
    joinLines,
    occurrenceLine,
    repeatLine,
    row,
} from "../ui.js";

/** 繰り返し予定を何日先まで展開して表示するか */
const REPEAT_DAYS = 14;

export const onViewCommand = async (interaction: Interaction) => {
    await interaction.respond(
        {
            content: "📋 予定をどこに表示しますか？\n" +
                "・🔒 自分だけ：すべての予定を表示します（あなたにしか見えません）\n" +
                "・👥 チャンネル：公開設定が「みんな」の予定だけを表示します",
            components: [
                row(
                    button("view:private", "🔒 自分だけに表示", ButtonStyle.Primary),
                    button("view:public", "👥 チャンネルに表示"),
                ),
            ],
        },
        { isPrivate: true },
    );
};

/** 一覧のテキストを作る。予定が無ければ undefined */
const buildList = (
    header: string,
    list: readonly Schedule[],
    userId: string,
    showVisibility: boolean,
): string | undefined => {
    const occurrences = upcomingOccurrences(list, userId, REPEAT_DAYS);
    const repeats = list.filter((s) => s.userId === userId && s.repeat && isActive(s));
    if (occurrences.length === 0 && repeats.length === 0) return undefined;

    const lines = occurrences.map((o) => occurrenceLine(o, showVisibility));
    if (lines.length === 0) lines.push("(これからの予定はありません)");
    if (repeats.length > 0) {
        lines.push("", "**🔁 繰り返しの予定**", ...repeats.map((s) => repeatLine(s, showVisibility)));
    }
    return joinLines(
        `${header}\n` + (repeats.length > 0 ? `(繰り返しの予定は${REPEAT_DAYS}日先まで表示)\n` : ""),
        lines,
    );
};

export const onViewButton = async (interaction: Interaction) => {
    const userId = interaction.user.id.toString();
    const all = await getSchedules();

    if (interaction.data.customId === "view:private") {
        const text = buildList("📋 **あなたの予定**（🔒 自分だけ / 👥 みんな）", all, userId, true);
        await interaction.edit({
            content: text ?? "📅 これからの予定はありません。",
            components: [],
        });
        return;
    }

    const publicOnly = all.filter((s) => s.visibility === "public");
    const text = buildList(`📋 **<@${userId}> の予定**`, publicOnly, userId, false);
    if (!text) {
        await interaction.edit({
            content: "👥 公開設定が「みんな」の予定がないため、チャンネルには何も表示しませんでした。",
            components: [],
        });
        return;
    }

    // 自分だけのメッセージを閉じてから、チャンネルに公開の一覧を送る
    await interaction.edit({ content: "👥 チャンネルに表示しました。", components: [] });
    await interaction.respond({ content: text, allowedMentions: { parse: [] } });
};
