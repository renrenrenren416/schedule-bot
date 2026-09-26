import type { CreateApplicationCommand } from "@discordeno/types";
import { ApplicationCommandOptionTypes } from "@discordeno/types";

const targetOption = (action: string) => ({
    name: "target",
    nameLocalizations: { ja: "予定" },
    description: `${action}する予定 (予定名か日付を入力すると候補が出ます)`,
    type: ApplicationCommandOptionTypes.String,
    required: true,
    autocomplete: true,
});

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
            description: "自分の予定を表示します",
            type: ApplicationCommandOptionTypes.SubCommand,
        },
        {
            name: "delete",
            description: "自分の予定を削除します",
            type: ApplicationCommandOptionTypes.SubCommand,
            options: [targetOption("削除")],
        },
        {
            name: "edit",
            description: "自分の予定を編集します",
            type: ApplicationCommandOptionTypes.SubCommand,
            options: [targetOption("編集")],
        },
    ],
};
