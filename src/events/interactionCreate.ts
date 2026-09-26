import { InteractionTypes } from "@discordeno/types";
import { readFile, writeFile } from "node:fs/promises";

const isValidDate = (date: unknown) => {
    if (typeof date !== "string") return false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parts = date.split("-");

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const checkDate = new Date(year, month - 1, day);

    return (
        checkDate.getFullYear() === year &&
        checkDate.getMonth() === month - 1 &&
        checkDate.getDate() === day
    );
};

const isValidTime = (time: unknown) => {
    if (typeof time !== "string") return false;

    const match = time.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) return false;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
};

const isDateTimeInRange = (date: unknown, time: unknown) => {
    if (!isValidDate(date) || !isValidTime(time)) {
        return false;
    }

    const [hour, minute] = (time as string).split(":");

    const normalizedTime = `${hour.padStart(2, "0")}:${minute}`;

    const targetDateTime = new Date(
        `${date}T${normalizedTime}:00`,
    );

    if (Number.isNaN(targetDateTime.getTime())) {
        return false;
    }

    const now = new Date();

    const oneYearLater = new Date(now);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    return targetDateTime >= now && targetDateTime <= oneYearLater;
};

const createDrafts = new Map<
    string,
    {
        name: string;
        date?: string;
        time?: string;
        visibility?: "private" | "public";
    }
>();

export const interactionCreate = async (interaction: any) => {
    if (
        interaction.type !== InteractionTypes.ApplicationCommand &&
        interaction.type !== InteractionTypes.ModalSubmit &&
        interaction.type !== InteractionTypes.MessageComponent
    ) {
        return;
    }

    // =========================
    // /ping
    // =========================
    if (
        interaction.type === InteractionTypes.ApplicationCommand &&
        interaction.data?.name === "ping"
    ) {
        const userId = interaction.user?.id;
        const guildId = interaction.guildId;

        console.log("ユーザーID:", userId);
        console.log("サーバーID:", guildId);

        await interaction.respond({
            content: `🏓 Pong!\nユーザーID: ${userId}\nサーバーID: ${guildId}`,
        });

        return;
    }

    // =========================
    // /schedule
    // =========================
    if (
        interaction.type === InteractionTypes.ApplicationCommand &&
        interaction.data?.name === "schedule"
    ) {
        const options = interaction.data.options ?? [];
        const subCommand = options.find(
            (option) => option.type === 1,
        );

        // -------------------------
        // create
        // -------------------------
        if (subCommand?.name === "create") {
            await interaction.respond({
                title: "予定を作成",
                customId: "schedule-create",
                components: [
                    {
                        type: 1,
                        components: [
                            {
                                type: 4,
                                style: 1,
                                label: "予定名",
                                customId: "schedule-name",
                                placeholder: "例：バイト",
                                required: true,
                            },
                        ],
                    },
                ],
            });

            return;
        }

        // -------------------------
        // view
        // -------------------------
        if (subCommand?.name === "view") {
            const schedules = JSON.parse(
                await readFile("./src/data/schedules.json", "utf-8"),
            );

            const userId = interaction.user?.id?.toString();

            const mySchedules = schedules.filter(
                (schedule) => schedule.userId === userId,
            );

            if (mySchedules.length === 0) {
                await interaction.respond({
                    content: "📅 登録されている予定はありません。",
                });
                return;
            }

            const scheduleText = mySchedules
                .map(
                    (schedule) =>
                        `📅 ${schedule.date} ${schedule.time}\n` +
                        `予定：${schedule.name}`,
                )
                .join("\n\n");

            await interaction.respond({
                content: `📋 あなたの予定\n\n${scheduleText}`,
            });

            return;
        }

        // -------------------------
        // delete
        // -------------------------
        if (subCommand?.name === "delete") {
            const subOptions = subCommand.options ?? [];

            const name = subOptions.find(
                (option) => option.name === "name",
            )?.value;

            const userId = interaction.user?.id?.toString();

            const schedules = JSON.parse(
                await readFile("./src/data/schedules.json", "utf-8"),
            );

            const mySchedules = schedules.filter(
                (schedule) => schedule.userId === userId,
            );

            const targetSchedule = mySchedules.find(
                (schedule) => schedule.name === name,
            );

            if (!targetSchedule) {
                await interaction.respond({
                    content: `❌ 「${name}」という予定は見つかりませんでした。`,
                });
                return;
            }

            const newSchedules = schedules.filter(
                (schedule) =>
                    !(
                        schedule.userId === userId &&
                        schedule.name === name
                    ),
            );

            await writeFile(
                "./src/data/schedules.json",
                JSON.stringify(newSchedules, null, 2),
            );

            await interaction.respond({
                content: `🗑️ 「${name}」を削除しました！`,
            });

            return;
        }

        // -------------------------
        // edit
        // -------------------------
        if (subCommand?.name === "edit") {
            const subOptions = subCommand.options ?? [];

            const name = subOptions.find(
                (option) => option.name === "name",
            )?.value;

            const date = subOptions.find(
                (option) => option.name === "date",
            )?.value;

            const time = subOptions.find(
                (option) => option.name === "time",
            )?.value;

            const errors = [];

            if (!isValidDate(date)) {
                errors.push(
                    "❌ 日付が正しくありません。`YYYY-MM-DD` の形式で入力してください。",
                );
            }

            if (!isValidTime(time)) {
                errors.push(
                    "❌ 時間が正しくありません。`HH:MM` の形式で入力してください。",
                );
            }

            if (
                isValidDate(date) &&
                isValidTime(time) &&
                !isDateTimeInRange(date, time)
            ) {
                errors.push(
                    "❌ 予定は現在時刻から1年以内で指定してください。",
                );
            }

            if (errors.length > 0) {
                await interaction.respond({
                    content: errors.join("\n"),
                });
                return;
            }

            const userId = interaction.user?.id?.toString();

            const schedules = JSON.parse(
                await readFile("./src/data/schedules.json", "utf-8"),
            );

            const scheduleIndex = schedules.findIndex(
                (schedule) =>
                    schedule.userId === userId &&
                    schedule.name === name,
            );

            if (scheduleIndex === -1) {
                await interaction.respond({
                    content: `❌ 「${name}」という予定は見つかりませんでした。`,
                });
                return;
            }

            schedules[scheduleIndex].date = date;
            schedules[scheduleIndex].time = time;
            schedules[scheduleIndex].notified = false;

            await writeFile(
                "./src/data/schedules.json",
                JSON.stringify(schedules, null, 2),
            );

            await interaction.respond({
                content: `✏️ 予定を変更しました！\n` +
                    `予定：${name}\n` +
                    `日時：${date} ${time}`,
            });

            return;
        }
    }

    // =========================
    // Modal送信
    // =========================
    if (
        interaction.type === InteractionTypes.ModalSubmit &&
        interaction.data?.customId === "schedule-create"
    ) {
        const components = interaction.data.components ?? [];

        const name = components
            .flatMap((row) => row.components ?? [])
            .find((component) => component.customId === "schedule-name")
            ?.value;

        const userId = interaction.user?.id?.toString();

        if (!userId || typeof name !== "string" || name.trim() === "") {
            await interaction.respond({
                content:
                    "❌ 予定名を取得できませんでした。もう一度やり直してください。",
            });
            return;
        }

        createDrafts.set(userId, {
            name: name.trim(),
        });

        console.log("予定名:", name);

        const today = new Date();

        const buttons = [];

        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");

            const dateValue = `${year}-${month}-${day}`;

            const label = `${month}/${day}`;

            buttons.push({
                type: 2,
                style: 1,
                label,
                customId: `schedule-date-${dateValue}`,
            });
        }

        const rows = [];

        for (let i = 0; i < buttons.length; i += 4) {
            rows.push({
                type: 1,
                components: buttons.slice(i, i + 4),
            });
        }

        await interaction.respond({
            content: `📅 「${name}」の予定\n\n` +
                `日付を選択してください。`,
            components: rows,
        });

        return;
    }

    // =========================
    // 日付ボタン
    // =========================
    if (
        interaction.type === InteractionTypes.MessageComponent &&
        interaction.data?.customId?.startsWith("schedule-date-")
    ) {
        const date = interaction.data.customId.replace(
            "schedule-date-",
            "",
        );

        const userId = interaction.user?.id?.toString();

        if (!userId) {
            await interaction.respond({
                content: "❌ ユーザー情報を取得できませんでした。",
            });
            return;
        }

        const draft = createDrafts.get(userId);

        if (!draft) {
            await interaction.respond({
                content:
                    "❌ 予定情報が見つかりませんでした。もう一度 `/schedule create` を実行してください。",
            });
            return;
        }

        draft.date = date;

        console.log("選択された日付:", date);
        console.log("予定名:", draft.name);

        const now = new Date();

        const hourButtons = [];

        for (let i = 0; i < 24; i++) {
            const hour = String(i).padStart(2, "0");

            const targetDateTime = new Date(
                `${date}T${hour}:00:00`,
            );

            const disabled = targetDateTime.getTime() < now.getTime() &&
                date ===
                    `${now.getFullYear()}-${
                        String(now.getMonth() + 1).padStart(2, "0")
                    }-${String(now.getDate()).padStart(2, "0")}`;

            hourButtons.push({
                type: 2,
                style: 1,
                label: `${hour}時`,
                customId: `schedule-hour-${hour}`,
                disabled,
            });
        }

        const rows = [];

        for (let i = 0; i < hourButtons.length; i += 4) {
            rows.push({
                type: 1,
                components: hourButtons.slice(i, i + 4),
            });
        }

        await interaction.respond({
            content: `📅 「${draft.name}」の予定\n` +
                `日付：${date}\n\n` +
                `時間を選択してください。`,
            components: rows,
        });

        return;
    }

    // =========================
    // 時ボタン
    // =========================
    if (
        interaction.type === InteractionTypes.MessageComponent &&
        interaction.data?.customId?.startsWith("schedule-hour-")
    ) {
        const hour = interaction.data.customId.replace(
            "schedule-hour-",
            "",
        );

        const userId = interaction.user?.id?.toString();

        if (!userId) {
            await interaction.respond({
                content: "❌ ユーザー情報を取得できませんでした。",
            });
            return;
        }

        const draft = createDrafts.get(userId);

        if (!draft || !draft.date) {
            await interaction.respond({
                content:
                    "❌ 予定情報が見つかりませんでした。もう一度 `/schedule create` を実行してください。",
            });
            return;
        }

        draft.time = `${hour}:00`;

        const now = new Date();

        const minuteButtons = [];

        for (let i = 0; i < 60; i += 5) {
            const minute = String(i).padStart(2, "0");
            const time = `${hour}:${minute}`;

            const targetDateTime = new Date(
                `${draft.date}T${time}:00`,
            );

            const disabled = targetDateTime.getTime() < now.getTime();

            minuteButtons.push({
                type: 2,
                style: 1,
                label: `${minute}分`,
                customId: `schedule-minute-${hour}-${minute}`,
                disabled,
            });
        }

        const rows = [];

        for (let i = 0; i < minuteButtons.length; i += 4) {
            rows.push({
                type: 1,
                components: minuteButtons.slice(i, i + 4),
            });
        }

        await interaction.respond({
            content: `📅 「${draft.name}」の予定\n` +
                `日付：${draft.date}\n` +
                `時間：${hour}時\n\n` +
                `分を選択してください。`,
            components: rows,
        });

        return;
    }

    // =========================
    // 分ボタン
    // =========================
    if (
        interaction.type === InteractionTypes.MessageComponent &&
        interaction.data?.customId?.startsWith("schedule-minute-")
    ) {
        const value = interaction.data.customId.replace(
            "schedule-minute-",
            "",
        );

        const [hour, minute] = value.split("-");

        const userId = interaction.user?.id?.toString();

        if (!userId) {
            await interaction.respond({
                content: "❌ ユーザー情報を取得できませんでした。",
            });
            return;
        }

        const draft = createDrafts.get(userId);

        if (!draft || !draft.date) {
            await interaction.respond({
                content:
                    "❌ 予定情報が見つかりませんでした。もう一度 `/schedule create` を実行してください。",
            });
            return;
        }

        draft.time = `${hour}:${minute}`;

        console.log("選択された時間:", draft.time);

        await interaction.respond({
            content: `📅 「${draft.name}」の予定\n` +
                `日付：${draft.date}\n` +
                `時間：${draft.time}\n\n` +
                `公開設定を選択してください。`,
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 1,
                            label: "🔒 自分だけ",
                            customId: "schedule-visibility-private",
                        },
                        {
                            type: 2,
                            style: 2,
                            label: "👥 みんな",
                            customId: "schedule-visibility-public",
                        },
                    ],
                },
            ],
        });

        return;
    }

    // =========================
    // 公開設定ボタン
    // =========================
    if (
        interaction.type === InteractionTypes.MessageComponent &&
        (
            interaction.data?.customId === "schedule-visibility-private" ||
            interaction.data?.customId === "schedule-visibility-public"
        )
    ) {
        const userId = interaction.user?.id?.toString();

        if (!userId) {
            await interaction.respond({
                content: "❌ ユーザー情報を取得できませんでした。",
            });
            return;
        }

        const draft = createDrafts.get(userId);

        if (!draft || !draft.date || !draft.time) {
            await interaction.respond({
                content:
                    "❌ 予定情報が見つかりませんでした。もう一度 `/schedule create` を実行してください。",
            });
            return;
        }

        const visibility =
            interaction.data.customId === "schedule-visibility-private"
                ? "private"
                : "public";

        draft.visibility = visibility;

        const visibilityText = visibility === "private"
            ? "🔒 自分だけ"
            : "👥 みんな";

        console.log("公開設定:", visibilityText);

        await interaction.respond({
            content: `📋 予定の確認\n\n` +
                `予定名：${draft.name}\n` +
                `日付：${draft.date}\n` +
                `時間：${draft.time}\n` +
                `公開設定：${visibilityText}\n\n` +
                `この内容で登録しますか？`,
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 3,
                            label: "✅ 作成する",
                            customId: "schedule-create-confirm",
                        },
                        {
                            type: 2,
                            style: 4,
                            label: "❌ キャンセル",
                            customId: "schedule-create-cancel",
                        },
                    ],
                },
            ],
        });

        return;
    }

    // =========================
    // 作成確認ボタン
    // =========================
    if (
        interaction.type === InteractionTypes.MessageComponent &&
        (
            interaction.data?.customId === "schedule-create-confirm" ||
            interaction.data?.customId === "schedule-create-cancel"
        )
    ) {
        const userId = interaction.user?.id?.toString();

        if (!userId) {
            await interaction.respond({
                content: "❌ ユーザー情報を取得できませんでした。",
            });
            return;
        }

        const draft = createDrafts.get(userId);

        if (!draft || !draft.date || !draft.time || !draft.visibility) {
            await interaction.respond({
                content:
                    "❌ 予定情報が見つかりませんでした。もう一度 `/schedule create` を実行してください。",
            });
            return;
        }

        // -------------------------
        // キャンセル
        // -------------------------
        if (interaction.data.customId === "schedule-create-cancel") {
            createDrafts.delete(userId);

            await interaction.respond({
                content: "❌ 予定の作成をキャンセルしました。",
                components: [],
            });

            return;
        }

        // -------------------------
        // 作成
        // -------------------------
        if (
            !isDateTimeInRange(
                draft.date,
                draft.time,
            )
        ) {
            createDrafts.delete(userId);

            await interaction.respond({
                content:
                    "❌ その日時は登録できません。現在時刻から1年以内の日時を指定してください。",
                components: [],
            });

            return;
        }

        const schedules = JSON.parse(
            await readFile("./src/data/schedules.json", "utf-8"),
        );

        schedules.push({
            userId,
            guildId: interaction.guildId?.toString(),
            channelId: interaction.channelId?.toString(),
            name: draft.name,
            date: draft.date,
            time: draft.time,
            visibility: draft.visibility,
            notified: false,
        });

        await writeFile(
            "./src/data/schedules.json",
            JSON.stringify(schedules, null, 2),
        );

        createDrafts.delete(userId);

        const visibilityText = draft.visibility === "private"
            ? "🔒 自分だけ"
            : "👥 みんな";

        await interaction.respond({
            content: `✅ 予定を登録しました！\n\n` +
                `予定名：${draft.name}\n` +
                `日時：${draft.date} ${draft.time}\n` +
                `公開設定：${visibilityText}`,
            components: [],
        });

        return;
    }
};
