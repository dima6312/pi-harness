import { type AskResult, isAskResult } from "@adeildo/pi-kit";
import type {
	AgentToolResult,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

/** While the model writes, each question shows as it arrives, so you can read them before the dialog opens. */
export function renderCall(
	params: Partial<QuestionParams>,
	theme: Theme,
	writing: boolean,
): Component {
	const questions = params.questions ?? [];
	const title = theme.fg("toolTitle", theme.bold("ask"));
	if (!writing) {
		return new Text(`${title} ${counted(questions.length, "question")}`, 0, 0);
	}
	return { render: (width) => writingLines(questions, title, theme, width), invalidate() {} };
}

function writingLines(questions: Streamed, title: string, theme: Theme, width: number): string[] {
	const rows = questions.map((question) => ({
		header: question?.header ?? "",
		text: question?.question ?? "",
		options: question?.options?.length ?? 0,
	}));
	const headers = Math.max(0, ...rows.map((row) => visibleWidth(row.header)));
	const lines = [`${title} ${theme.fg("muted", `${counted(rows.length, "question")} so far`)}`];
	for (const [index, row] of rows.entries()) {
		// The last question is the one the model is still writing.
		const options = index === rows.length - 1 ? "writing" : counted(row.options, "option");
		const pad = " ".repeat(headers - visibleWidth(row.header));
		const lead = `  ${theme.fg("accent", row.header)}${pad}  `;
		const room = Math.max(1, width - visibleWidth(lead) - options.length - 2);
		const text = truncateToWidth(row.text, room, "...");
		const gap = Math.max(2, width - visibleWidth(lead) - visibleWidth(text) - options.length);
		const line = `${lead}${theme.fg("muted", text)}${" ".repeat(gap)}${theme.fg("dim", options)}`;
		lines.push(truncateToWidth(line, width));
	}
	return lines;
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
			...questions.flatMap((question) =>
				answerBlock(question, answerTo(question), theme, width, expanded),
			),
		],
		invalidate() {},
	};
}
