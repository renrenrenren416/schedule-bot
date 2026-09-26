// /schedule google: Google カレンダーとの連携・解除

import { config } from "../config.js";
import { syncAllFor } from "../google/calendar.js";
import { createAuthUrl, unlink } from "../google/oauth.js";
import { isLinked } from "../google/tokens.js";
import { button, ButtonStyle, type Interaction, linkButton, row } from "../ui.js";

const about = "連携すると、\n" +
    "・Bot で登録した予定が Google カレンダーにも自動で入ります（編集・削除も反映）\n" +
    "・`/schedule view`（自分だけ）に Google カレンダーの予定も表示されます 📆";

export const onGoogleCommand = async (interaction: Interaction) => {
    if (!config.google) {
        await interaction.respond(
            { content: "この Bot では Google カレンダー連携が設定されていません。" },
            { isPrivate: true },
        );
        return;
    }

    const userId = interaction.user.id.toString();
    if (await isLinked(userId)) {
        await interaction.respond(
            {
                content: `✅ **Google カレンダーと連携中です**\n\n${about}`,
                components: [
                    row(
                        button("g:resync", "🔄 予定をもう一度 Google に登録"),
                        button("g:unlink", "連携を解除", ButtonStyle.Danger),
                    ),
                ],
            },
            { isPrivate: true },
        );
        return;
    }

    const url = createAuthUrl(userId, interaction.token);
    await interaction.respond(
        {
            content: `📆 **Google カレンダーと連携**\n\n${about}\n\n` +
                "下のボタンから Google にログインしてください（リンクの有効期限は10分です）。",
            components: [row(linkButton(url, "Google でログイン"))],
        },
        { isPrivate: true },
    );
};

export const onGoogleButton = async (interaction: Interaction) => {
    const userId = interaction.user.id.toString();

    if (interaction.data.customId === "g:unlink") {
        await unlink(userId);
        await interaction.edit({
            content: "連携を解除しました。これまでに Google カレンダーへ登録した予定はそのまま残ります。",
            components: [],
        });
        return;
    }

    if (interaction.data.customId === "g:resync") {
        await interaction.edit({
            content: "🔄 これからの予定を Google カレンダーに登録しています。少し待ってからカレンダーを確認してください。",
            components: [],
        });
        void syncAllFor(userId).catch((error) => console.error("再同期に失敗しました", error));
    }
};
