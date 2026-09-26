import { createBot } from "@discordeno/bot";

import { pingCommand } from "./commands/ping.js";
import { scheduleCommand } from "./commands/schedule.js";
import { config } from "./config.js";
import { interactionCreate } from "./events/interactionCreate.js";
import { type NotifierBot, startScheduler } from "./scheduler.js";
import { startServer } from "./server.js";

const bot = createBot({
    token: config.discordToken,
    desiredProperties: {
        interaction: {
            id: true,
            data: true,
            type: true,
            token: true,
            user: true,
            guildId: true,
            channelId: true,
        },
        user: {
            id: true,
        },
        channel: {
            id: true,
        },
    },
    events: {
        ready: ({ shardId }) => {
            console.log(`Shard ${shardId} ready!`);
        },
        interactionCreate,
    },
});

const commands = [pingCommand, scheduleCommand];

if (config.guildId) {
    // 開発用: 指定したサーバーにだけ登録 (すぐ反映される)
    await bot.rest.upsertGuildApplicationCommands(config.guildId, commands);
    console.log(`コマンドをサーバー ${config.guildId} に登録しました`);
} else {
    // 公開用: すべてのサーバーに登録 (反映に時間がかかることがある)
    await bot.rest.upsertGlobalApplicationCommands(commands);
    console.log("コマンドをグローバルに登録しました");
}

startScheduler(bot as unknown as NotifierBot);

if (config.google) {
    startServer({
        // 連携が終わったら、/schedule google の「自分だけ」メッセージを書き換える
        onLinked: async (_userId, interactionToken) => {
            if (!interactionToken) return;
            await bot.helpers.editOriginalInteractionResponse(interactionToken, {
                content: "✅ **Google カレンダーと連携しました！**\n" +
                    "これからの予定を Google カレンダーに登録しています。",
                components: [],
            }).catch(() => {}); // 15分以上たつと書き換えられないので無視
        },
    });
} else {
    console.log("Google 連携の設定が無いため、連携機能はオフです (.env.example を参照)");
}
await bot.start();
