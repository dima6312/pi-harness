// One question and what you answered, drawn the same in the review tab and in the transcript: the
// marks are the dialog's, a tick for an answer and an arrow for a note.
import { type AskAnswer, isAnswered } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const NOTE_MARK = "\u203a";
const PICKED = "\u2713 ";
const MISSING = "\u25cb ";
const INDENT = "  ";

export interface Asked {
	question: string;
	header: string;
}

/**
 * The header and the question, then the answer under it: each pick with the notes on it, your own
 * words in quotes, and the notes on options you did not pick. `whole` wraps the question instead of
 * cutting it to one line.
 */
export function answerBlock(
	asked: Asked,
	answer: AskAnswer | undefined,
	theme: Theme,
	width: number,
	whole: boolean,
): string[] {
	const head = `${theme.fg("accent", theme.bold(asked.header))}  `;
	const question = theme.fg("muted", asked.question);
	const lines = whole
		? hanging(head, question, width)
		: [truncateToWidth(head + question, width, "...")];

	const tick = INDENT + theme.fg("success", PICKED);
	const note = (lead: string, text: string) =>
		hanging(lead + theme.fg("warning", `${NOTE_MARK} `), text, width);
	const notes = answer?.notes ?? [];
	const picked = answer?.picked ?? [];

	if (answer === undefined || !isAnswered(answer))
		lines.push(INDENT + theme.fg("warning", `${MISSING}not answered`));
	for (const label of picked) {
		lines.push(...hanging(tick, theme.fg("text", label), width));
		for (const on of notes.filter((item) => item.option === label))
			lines.push(...note(INDENT + INDENT, theme.fg("text", on.note)));
	}
	const typed = answer?.typed?.trim();
	if (typed) lines.push(...hanging(tick, theme.fg("text", `"${typed}"`), width));
	for (const on of notes.filter((item) => !picked.includes(item.option)))
		lines.push(
			...note(INDENT, `${theme.fg("muted", `on ${on.option}:`)} ${theme.fg("text", on.note)}`),
		);
	return lines;
}

/** Wrapped under its lead, so a long answer keeps its indent instead of running back to the edge. */
function hanging(lead: string, text: string, width: number): string[] {
	const indent = visibleWidth(lead);
	return wrapTextWithAnsi(text, Math.max(1, width - indent)).map(
		(line, index) => (index === 0 ? lead : " ".repeat(indent)) + line,
	);
}
