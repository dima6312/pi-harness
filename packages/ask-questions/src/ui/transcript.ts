import { type AskResult, isAskResult } from "@adeildo/pi-kit";
import type {
	AgentToolResult,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { QuestionParams } from "../schema.ts";
import { type Asked, answerBlock } from "./answered.ts";

type Streamed = NonNullable<Partial<QuestionParams>["questions"]>;

/** What the tool registers, and what the docs draw. */
export const ASK_RENDERERS = {
	renderCall: (args: Partial<QuestionParams>, theme: Theme, context: { argsComplete: boolean }) =>
		renderCall(args, theme, !context.argsComplete),
	renderResult: (
		result: AgentToolResult<AskResult | undefined>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: { args: { questions?: readonly Asked[] } },
	) => renderResult(result, options.expanded, theme, context.args.questions),
};

/**
 * One line for each question, and the one the model is still writing whole: its text and the
 * options as they arrive, with a cursor where it writes. So you can read them before the dialog opens.
 */
export function renderCall(
	params: Partial<QuestionParams>,
	theme: Theme,
	writing: boolean,
): Component {
	const questions = params.questions ?? [];
	return { render: (width) => questionLines(questions, theme, width, writing), invalidate() {} };
}

const CURSOR = "\u258d";

function questionLines(
	questions: Streamed,
	theme: Theme,
	width: number,
	writing: boolean,
): string[] {
	const rows = questions.map((question) => ({
		header: question?.header ?? "",
		text: question?.question ?? "",
		options: (question?.options ?? []).map((option) => option?.label ?? ""),
	}));
	const headers = Math.max(0, ...rows.map((row) => visibleWidth(row.header)));
	const lines: string[] = [];
	for (const [index, row] of rows.entries()) {
		const pad = " ".repeat(headers - visibleWidth(row.header));
		const lead = `${theme.fg("accent", row.header)}${pad}  `;
		if (writing && index === rows.length - 1) {
			lines.push(...writingQuestion(lead, row, theme, width));
			continue;
		}
		const count = theme.fg("dim", counted(row.options.length, "option"));
		const room = Math.max(1, width - visibleWidth(lead) - visibleWidth(count) - 2);
		const text = theme.fg("muted", truncateToWidth(row.text, room, "..."));
		const gap = " ".repeat(
			Math.max(2, width - visibleWidth(lead) - visibleWidth(text) - visibleWidth(count)),
		);
		lines.push(truncateToWidth(`${lead}${text}${gap}${count}`, width));
	}
	return lines;
}

/** The question being written, whole, with its options numbered under it as they arrive. */
function writingQuestion(
	lead: string,
	row: { text: string; options: string[] },
	theme: Theme,
	width: number,
): string[] {
	const indent = " ".repeat(visibleWidth(lead));
	const room = Math.max(1, width - indent.length);
	const text = wrapTextWithAnsi(theme.fg("text", row.text), room);
	const lines = text.map((line, index) => (index === 0 ? lead : indent) + line);
	for (const [index, label] of row.options.entries())
		lines.push(
			truncateToWidth(
				`${indent}${theme.fg("dim", String(index + 1))} ${theme.fg("text", label)}`,
				width,
			),
		);
	if (lines.length === 0) return [];
	return [...lines.slice(0, -1), `${lines.at(-1)}${theme.fg("accent", CURSOR)}`];
}

function contentText(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function counted(count: number, word: string): string {
	return count === 1 ? `1 ${word}` : `${count} ${word}s`;
}

/** Each question with what you answered under it. Expanded, the questions are not cut. */
export function renderResult(
	result: AgentToolResult<AskResult | undefined>,
	expanded: boolean,
	theme: Theme,
	asked: readonly Asked[] | undefined,
): Component {
	const details = result.details;
	// A tool that throws reaches here with pi's `details: {}` and the error in the content.
	if (!isAskResult(details)) return new Text(theme.fg("warning", contentText(result)), 0, 0);
	if (details.error !== undefined) return new Text(theme.fg("warning", details.error), 0, 0);
	// An answer keeps its question, so the result draws alone when the call's arguments are gone.
	const questions = asked ?? details.answers;
	const answerTo = (question: Asked) =>
		details.answers.find(
			(answer) => answer.question === question.question && answer.header === question.header,
		);
	return {
		render: (width) => [
			...(details.cancelled ? [theme.fg("warning", "closed without submitting")] : []),
			...questions.flatMap((question, index) =>
				answerBlock(
					question,
					answerTo(question),
					theme,
					width,
					expanded,
					questions.length > 1 ? index + 1 : undefined,
				),
			),
		],
		invalidate() {},
	};
}
