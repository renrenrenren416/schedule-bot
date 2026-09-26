import type { CreateApplicationCommand } from "@discordeno/types";
import { ApplicationCommandOptionTypes } from "@discordeno/types";

export const scheduleCommand: CreateApplicationCommand = {
    name: "schedule",
    description: "予定を管理します",

    options: [
        {
            name: "create",
            description: "予定を登録します",
            type: ApplicationCommandOptionTypes.SubCommand,
        },

        {
            name: "view",
            description: "自分の予定を確認します",
            type: ApplicationCommandOptionTypes.SubCommand,
        },

        {
            name: "delete",
            description: "予定を削除します",
            type: ApplicationCommandOptionTypes.SubCommand,
            options: [
                {
                    name: "name",
                    description: "削除する予定の名前",
                    type: ApplicationCommandOptionTypes.String,
                    required: true,
                },
            ],
        },

        {
            name: "edit",
            description: "予定を変更します",
            type: ApplicationCommandOptionTypes.SubCommand,
            options: [
                {
                    name: "name",
                    description: "変更する予定の名前",
                    type: ApplicationCommandOptionTypes.String,
                    required: true,
                },
                {
                    name: "date",
                    description: "新しい日付（例：2026-09-10）",
                    type: ApplicationCommandOptionTypes.String,
                    required: true,
                },
                {
                    name: "time",
                    description: "新しい時間（例：18:00）",
                    type: ApplicationCommandOptionTypes.String,
                    required: true,
                },
            ],
        },
    ],
};
