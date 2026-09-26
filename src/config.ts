import "dotenv/config";

const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`環境変数 ${key} が設定されていません。.env を確認してください。`);
    }
    return value;
};

export const config = {
    /** Discord Bot のトークン */
    discordToken: required("DISCORD_TOKEN"),
    /** 開発用: 指定するとそのサーバーだけにコマンドを即時登録する。空ならグローバル登録 */
    guildId: process.env.GUILD_ID || undefined,
    /** 日時の解釈と通知時刻の基準にするタイムゾーン */
    timeZone: process.env.TIMEZONE || "Asia/Tokyo",
    /** 前日の何時に通知するか (0-23) */
    notifyHour: Number(process.env.NOTIFY_HOUR ?? 21),
    /** 予定データの保存先 */
    dataFile: process.env.DATA_FILE || "./src/data/schedules.json",
};
