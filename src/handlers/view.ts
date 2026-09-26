// /schedule view: 月ごとに予定を表示する (今月から1年先まで)
//
// まず「自分だけ」に今月の予定を出し、◀ ▶ やメニューで月を移動できる。
// 「この月をチャンネルに表示」を押したときだけ、その月の公開予定をチャンネルに出す。
// Google カレンダーと連携している人は、自分だけの表示に Google の予定 (📆) も並ぶ。
// Google の予定はチャンネルには出さない (公開してよいか分からないため)。

import { type GoogleEvent, listGoogleEvents } from "../google/calendar.js";
import { isLinked } from "../google/tokens.js";
import { isActive, occurrencesBetween } from "../recurrence.js";
import { getSchedules, type Schedule } from "../store.js";
import { addMonths, formatDate, formatMonth, monthOf, monthRange, nowLocal } from "../time.js";
import {
    button,
    ButtonStyle,
    type Interaction,
    joinLines,
    occurrenceLine,
    repeatLine,
    row,
    select,
    type SelectOption,
} from "../ui.js";

/** 今月から何か月先まで見られるか */
const MONTHS_AHEAD = 12;

const monthList = (): string[] => {
    const current = monthOf(nowLocal().date);
    return Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => addMonths(current, i));
};

/** その月の予定一覧のテキスト */
const monthText = (
    header: string,
    list: readonly Schedule[],
    userId: string,
    month: string,
    showVisibility: boolean,
    googleEvents: GoogleEvent[] = [],
): { text: string; count: number } => {
    const { from, to } = monthRange(month);
    const occurrences = occurrencesBetween(list, userId, from, to);
    // この月にかかっている繰り返し予定だけ
    const repeats = list.filter((s) =>
        s.userId === userId && s.repeat && isActive(s) &&
        s.date <= to && (!s.repeat.until || s.repeat.until >= from)
    );

    // Bot の予定と Google の予定を日時順に混ぜる (終日の予定はその日の先頭)
    const entries = [
        ...occurrences.map((o) => ({ key: `${o.date} ${o.time}`, line: occurrenceLine(o, showVisibility) })),
        ...googleEvents.map((g) => ({
            key: `${g.date} ${g.time ?? ""}`,
            line: `• **${formatDate(g.date)} ${g.time ?? "終日"}**　${g.title}　📆`,
        })),
    ].sort((a, b) => a.key.localeCompare(b.key));

    const lines = entries.map((e) => e.line);
    if (lines.length === 0) lines.push("(この月の予定はありません)");
    if (repeats.length > 0) {
        lines.push("", "**🔁 繰り返しの予定**", ...repeats.map((s) => repeatLine(s, showVisibility)));
    }
    return { text: joinLines(header, lines), count: occurrences.length };
};

/** 自分だけに見える月表示 */
const privatePage = async (list: readonly Schedule[], userId: string, month: string) => {
    const months = monthList();
    const first = months[0]!;
    const last = months[months.length - 1]!;
    const index = months.indexOf(month);

    let googleEvents: GoogleEvent[] | undefined;
    let googleFailed = false;
    try {
        const { from, to } = monthRange(month);
        googleEvents = await listGoogleEvents(userId, from, to);
    } catch (error) {
        console.error("Google の予定の読み込みに失敗しました", error);
        googleFailed = true;
    }

    const { text } = monthText(
        `📅 **${formatMonth(month)}の予定**（🔒 自分だけ / 👥 みんな${googleEvents ? " / 📆 Google" : ""}）`,
        list,
        userId,
        month,
        true,
        googleEvents,
    );

    // 1年より先の予定があれば件数だけ知らせる
    const beyond = list.filter((s) =>
        s.userId === userId && !s.repeat && s.date > monthRange(last).to
    ).length;
    let footer = beyond > 0 ? `\n\n※ ${formatMonth(last)}より先の予定が ${beyond} 件あります` : "";
    if (googleFailed) footer += "\n\n⚠️ Google カレンダーの予定を読み込めませんでした";

    const options: SelectOption[] = months.map((m) => ({
        label: formatMonth(m),
        value: m,
        default: m === month,
    }));

    return {
        content: text + footer,
        components: [
            row(select("vm:jump", "月を選ぶ", options)),
            row(
                button(`vm:go:${addMonths(month, -1)}`, "◀ 前の月", ButtonStyle.Secondary, month <= first || index === -1),
                button(`vm:go:${addMonths(month, 1)}`, "次の月 ▶", ButtonStyle.Secondary, month >= last || index === -1),
                button(`vm:share:${month}`, "👥 この月をチャンネルに表示", ButtonStyle.Primary),
            ),
        ],
    };
};

export const onViewCommand = async (interaction: Interaction) => {
    const userId = interaction.user.id.toString();
    const month = monthOf(nowLocal().date);
    // Google から読み込むと3秒以内に返事できないことがあるので、先に「考え中」にしておく
    if (await isLinked(userId)) {
        await interaction.defer(true);
        await interaction.edit(await privatePage(await getSchedules(), userId, month));
        return;
    }
    await interaction.respond(await privatePage(await getSchedules(), userId, month), { isPrivate: true });
};

export const onViewInteraction = async (interaction: Interaction) => {
    const [, action, arg] = String(interaction.data.customId).split(":");
    const userId = interaction.user.id.toString();
    const list = await getSchedules();
    const months = monthList();

    if (action === "jump" || action === "go") {
        const target = action === "jump" ? interaction.data.values?.[0] : arg;
        // 範囲外 (日付が変わって古くなったボタンなど) は今月に戻す
        const month = target && months.includes(target) ? target : months[0]!;
        if (await isLinked(userId)) await interaction.deferEdit();
        await interaction.edit(await privatePage(list, userId, month));
        return;
    }

    if (action === "share" && arg) {
        const publicOnly = list.filter((s) => s.visibility === "public");
        const { text, count } = monthText(
            `📅 **<@${userId}> の${formatMonth(arg)}の予定**`,
            publicOnly,
            userId,
            arg,
            false,
        );
        if (count === 0) {
            await interaction.respond(
                { content: `👥 ${formatMonth(arg)}に公開設定が「みんな」の予定がないため、チャンネルには何も表示しませんでした。` },
                { isPrivate: true },
            );
            return;
        }
        await interaction.respond({ content: text, allowedMentions: { parse: [] } });
    }
};
