import type { CreateApplicationCommand } from "@discordeno/types";

export const pingCommand: CreateApplicationCommand = {
    name: "ping",
    description: "Botの応答を確認します",
};
