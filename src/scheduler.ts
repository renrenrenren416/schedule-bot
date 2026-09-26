import { readFile, writeFile } from "node:fs/promises";

export const checkSchedules = async (bot: any) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const tomorrowDate = `${tomorrow.getFullYear()}-` +
        `${String(tomorrow.getMonth() + 1).padStart(2, "0")}-` +
        `${String(tomorrow.getDate()).padStart(2, "0")}`;

    console.log("明日の日付:", tomorrowDate);

    const schedules = JSON.parse(
        await readFile("./src/data/schedules.json", "utf-8"),
    );

    const tomorrowSchedules = schedules.filter(
        (schedule) => schedule.date === tomorrowDate,
    );

    console.log("明日の予定:", tomorrowSchedules);

    for (const schedule of tomorrowSchedules) {
        if (schedule.notified === true) {
            continue;
        }

        await bot.helpers.sendMessage(schedule.channelId, {
            content: `📅 <@${schedule.userId}>\n` +
                `明日の予定があります！\n` +
                `予定：${schedule.name}\n` +
                `時間：${schedule.time}`,
        });

        schedule.notified = true;
    }

    await writeFile(
        "./src/data/schedules.json",
        JSON.stringify(schedules, null, 2),
    );
};

export const startScheduler = (bot: any) => {
    const scheduleNextCheck = () => {
        const now = new Date();

        const next = new Date(now);

        next.setHours(21, 0, 0, 0);

        // すでに21:00を過ぎていたら、次の日の21:00にする
        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }

        const delay = next.getTime() - now.getTime();

        console.log(`次の通知チェックまで ${delay / 1000} 秒`);

        setTimeout(async () => {
            console.log("21:00です。通知チェックを開始します！");

            await checkSchedules(bot);

            // 次の21:00を予約
            scheduleNextCheck();
        }, delay);
    };

    scheduleNextCheck();
};
