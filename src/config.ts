import "dotenv/config";

const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`環境変数 ${key} が設定されていません。.env を確認してください。`);
    }
    return value;
};

/** Google 連携の設定。必要な値がそろっていなければ undefined (連携機能はオフ) */
const googleConfig = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, "");
    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!clientId || !clientSecret || !publicUrl || !encryptionKey) return undefined;

    const key = Buffer.from(encryptionKey, "base64");
    if (key.length !== 32) {
        throw new Error(
            "TOKEN_ENCRYPTION_KEY は32バイトを base64 にした値にしてください。README の手順で作れます。",
        );
    }
    return {
        clientId,
        clientSecret,
        /** このURL + /oauth/google/callback を Google Cloud に登録する */
        publicUrl,
        redirectUri: `${publicUrl}/oauth/google/callback`,
        encryptionKey: key,
    };
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
    /** Google のトークン (暗号化済み) の保存先 */
    tokenFile: process.env.TOKEN_FILE || "./src/data/tokens.json",
    /** OAuth のリダイレクトを受ける Web サーバーのポート */
    port: Number(process.env.PORT ?? 3000),
    google: googleConfig(),
};
