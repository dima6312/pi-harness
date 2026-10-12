import { answerSummary, type AskResult, isAnswered } from "@adeildo/pi-kit";
import type {
	AgentToolResult,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import type { QuestionParams } from "../schema.ts";

export function renderCall(params: Partial<QuestionParams>, theme: Theme): Text {
	const questions = params.questions ?? [];
	const headers = questions.map((question) => question?.header).filter(Boolean);
	const count = questions.length === 1 ? "1 question" : `${questions.length} questions`;
	const tail = headers.length === 0 ? "" : theme.fg("muted", `  ${headers.join(", ")}`);
	return new Text(`${theme.fg("toolTitle", theme.bold("ask"))} ${count}${tail}`, 0, 0);
}

export function renderResult(
	result: AgentToolResult<AskResult | undefined>,
	_options: ToolRenderResultOptions,
	theme: Theme,
): Text {
	const details = result.details;
	if (details === undefined) return new Text("", 0, 0);
	if (details.error !== undefined) return new Text(theme.fg("warning", details.error), 0, 0);

	const lines: string[] = [];
	if (details.cancelled) lines.push(theme.fg("warning", "closed without submitting"));
	for (const answer of details.answers) {
		const value = isAnswered(answer) ? answerSummary(answer) : theme.fg("dim", "not answered");
		lines.push(`${theme.fg("accent", answer.header)}  ${value}`);
		for (const { option, note } of answer.notes)
			lines.push(theme.fg("dim", `  note on ${option}: ${note}`));
	}
	return new Text(lines.join("\n"), 0, 0);
}
