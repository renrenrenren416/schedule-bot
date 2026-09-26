// /schedule view: 表示先 (自分だけ / チャンネル) を選んでから予定を出す

import { getSchedules, upcomingFor } from "../store.js";
import { button, ButtonStyle, type Interaction, row, scheduleList } from "../ui.js";

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

export const onViewButton = async (interaction: Interaction) => {
    const userId = interaction.user.id.toString();
    const mine = upcomingFor(await getSchedules(), userId);

    if (interaction.data.customId === "view:private") {
        await interaction.edit({
            content: mine.length === 0
                ? "📅 これからの予定はありません。"
                : scheduleList("📋 **あなたの予定**（🔒 自分だけ / 👥 みんな）", mine),
            components: [],
        });
        return;
    }

    const publicOnes = mine.filter((s) => s.visibility === "public");
    if (publicOnes.length === 0) {
        await interaction.edit({
            content: "👥 公開設定が「みんな」の予定がないため、チャンネルには何も表示しませんでした。",
            components: [],
        });
        return;
    }

    // 自分だけのメッセージを閉じてから、チャンネルに公開の一覧を送る
    await interaction.edit({ content: "👥 チャンネルに表示しました。", components: [] });
    await interaction.respond({
        content: scheduleList(`📋 **<@${userId}> の予定**`, publicOnes, false),
        allowedMentions: { parse: [] },
    });
};
