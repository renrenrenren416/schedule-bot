import "dotenv/config";
import { createBot } from "@discordeno/bot";

import { pingCommand } from "./commands/ping.js";
import { scheduleCommand } from "./commands/schedule.js";
import { interactionCreate } from "./events/interactionCreate.js";
import { startScheduler } from "./scheduler.js";

const bot = createBot({
    token: process.env.DISCORD_TOKEN!,
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
    },

    events: {
        ready: ({ shardId }) => {
            console.log(`Shard ${shardId} ready!`);
        },

        interactionCreate,
    },
});

const guildId = process.env.GUILD_ID!;

await bot.rest.upsertGuildApplicationCommands(guildId, [
    pingCommand,
    scheduleCommand,
]);

await bot.start();
startScheduler(bot);
