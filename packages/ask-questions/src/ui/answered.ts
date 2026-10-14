// One question and what you answered, drawn the same in the review tab and in the transcript. Each
// part says what it is: a tick for an option you picked, "your words" for what you typed, "note"
// for a note, and an empty circle for a question left without an answer.
import { type AskAnswer, isAnswered } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** The mark the dialog puts on an option with a note. */
export const NOTE_MARK = "\u203a";
const PICKED = "\u2713 ";
const TYPED = "\u270e ";
const MISSING = "\u25cb ";
const INDENT = "   ";

export interface Asked {
	question: string;
	header: string;
}

/**
 * The header, the question under it, then the answer: each pick with its notes, your own words,
 * and the notes on options you did not pick. `number` counts the questions when there are several.
 * `whole` wraps the question instead of cutting it to one line.
 */
export function answerBlock(
	asked: Asked,
	answer: AskAnswer | undefined,
	theme: Theme,
	width: number,
	whole: boolean,
	number?: number,
): string[] {
	const count = number === undefined ? "" : `${theme.fg("dim", String(number).padEnd(2))} `;
	const lines = [truncateToWidth(count + theme.fg("accent", theme.bold(asked.header)), width)];
	const question = theme.fg("muted", asked.question);
	if (whole) lines.push(...hanging(INDENT, question, width));
	else lines.push(truncateToWidth(INDENT + question, width, "..."));

	const notes = answer?.notes ?? [];
	const picked = answer?.picked ?? [];
	const note = (lead: string, label: string, text: string) =>
		hanging(`${lead}${theme.fg("warning", label)}  `, theme.fg("text", text), width);

	if (answer === undefined || !isAnswered(answer))
		lines.push(INDENT + theme.fg("warning", `${MISSING}not answered`));
	for (const label of picked) {
		lines.push(...hanging(INDENT + theme.fg("success", PICKED), theme.fg("text", label), width));
		for (const on of notes.filter((item) => item.option === label))
			lines.push(...note(`${INDENT}  `, "note", on.note));
	}
	const typed = answer?.typed?.trim();
	if (typed) {
		const lead = `${INDENT}${theme.fg("accent", TYPED)}${theme.fg("muted", "your words")}  `;
		lines.push(...hanging(lead, theme.fg("text", typed), width));
	}
	for (const on of notes.filter((item) => !picked.includes(item.option)))
		lines.push(...note(INDENT, `note on ${on.option}`, on.note));
	return lines;
}

/** Wrapped under its lead, so a long answer keeps its indent instead of running back to the edge. */
function hanging(lead: string, text: string, width: number): string[] {
	const indent = visibleWidth(lead);
	return wrapTextWithAnsi(text, Math.max(1, width - indent)).map(
		(line, index) => (index === 0 ? lead : " ".repeat(indent)) + line,
	);
}
