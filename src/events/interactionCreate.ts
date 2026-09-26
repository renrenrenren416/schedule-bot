import { InteractionTypes } from "@discordeno/types";

import { onGoogleButton, onGoogleCommand } from "../handlers/google.js";
import { onAutocomplete, onDeleteButton, onManageCommand, onPick } from "../handlers/manage.js";
import { onDayPanel, onDaySelect, onSeriesButton } from "../handlers/occurrence.js";
import { onCreateNameSubmit, onPanelInteraction, startCreate } from "../handlers/panel.js";
import { onViewCommand, onViewInteraction } from "../handlers/view.js";
import type { Interaction } from "../ui.js";

const route = async (interaction: Interaction) => {
    const data = interaction.data;

    switch (interaction.type) {
        case InteractionTypes.ApplicationCommand: {
            if (data?.name === "ping") {
                await interaction.respond({ content: "🏓 Pong!" }, { isPrivate: true });
                return;
            }
            if (data?.name !== "schedule") return;

            const sub = data.options?.[0]?.name;
            if (sub === "create") return startCreate(interaction);
            if (sub === "view") return onViewCommand(interaction);
            if (sub === "delete") return onManageCommand(interaction, "delete");
            if (sub === "edit") return onManageCommand(interaction, "edit");
            if (sub === "google") return onGoogleCommand(interaction);
            return;
        }

        case InteractionTypes.ApplicationCommandAutocomplete:
            if (data?.name === "schedule") return onAutocomplete(interaction);
            return;

        case InteractionTypes.MessageComponent:
        case InteractionTypes.ModalSubmit: {
            const id = String(data?.customId ?? "");
            if (id === "create-name") return onCreateNameSubmit(interaction);
            if (id.startsWith("panel:")) return onPanelInteraction(interaction);
            if (id.startsWith("vm:")) return onViewInteraction(interaction);
            if (id.startsWith("pick:")) return onPick(interaction);
            if (id.startsWith("del:")) return onDeleteButton(interaction);
            if (id.startsWith("ser:")) return onSeriesButton(interaction);
            if (id.startsWith("day:")) return onDaySelect(interaction);
            if (id.startsWith("occ:")) return onDayPanel(interaction);
            if (id.startsWith("g:")) return onGoogleButton(interaction);
            return;
        }
    }
};

export const interactionCreate = async (interaction: Interaction) => {
    try {
        await route(interaction);
    } catch (error) {
        console.error("インタラクションの処理中にエラー:", error);
        // 自動補完には通常のメッセージで返信できない
        if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) return;
        const message = { content: "⚠️ エラーが発生しました。時間をおいてもう一度お試しください。" };
        try {
            if (interaction.acknowledged) {
                await interaction.bot.helpers.sendFollowupMessage(interaction.token, {
                    ...message,
                    flags: 64,
                });
            } else {
                await interaction.respond(message, { isPrivate: true });
            }
        } catch {
            // 返信すらできない場合は諦める
        }
    }
};
