import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

const JUDGE_LOG_LIMIT = 50;

export function remember(record: JudgeRecord, log: JudgeRecord[]): void {
	log.push(record);
	if (log.length > JUDGE_LOG_LIMIT) log.shift();
}

export function warnOnce(ctx: ExtensionContext, warned: Set<string>, record: JudgeRecord): void {
	const code = record.error ?? "error";
	if (warned.has(code)) return;

	warned.add(code);
	ctx.ui.notify(`${NAME}: ${record.reason}`, "warning");
}

export function judgeLogText(log: JudgeRecord[], limit = 10): string {
	if (log.length === 0) return `${NAME}: no judge decisions this session`;

	const lines = log.slice(-limit).toReversed().map(describeJudgeRecord);
	return [`${NAME}: ${log.length} judge decisions, newest first`, ...lines].join("\n");
}

function describeJudgeRecord(record: JudgeRecord): string {
	return `${judgeActionLabel(record)} ${record.toolName}: ${oneLine(record.summary)}, ${record.reason} (${judgeStatText(record)}, ${record.model})`;
}

export function judgeActionLabel(record: JudgeRecord): string {
	if (record.action === "allow") return record.dryRun ? "would approve" : "approved";
	if (record.action === "deny") return record.dryRun ? "would deny" : "denied";
	return record.dryRun ? "would ask you" : "ask you";
}

export function judgeStatText(record: JudgeRecord): string {
	const parts: string[] = [];

	const confidence = record.answers.verdict?.confidence;
	if (confidence !== undefined) parts.push(`${Math.round(confidence * 100)}%`);
	if (record.error) parts.push(`error ${record.error}`);
	if (record.risk !== undefined) parts.push(`risk ${record.risk.toFixed(2)}`);
	parts.push(`${record.elapsedMs}ms`);

	return parts.join(", ");
}

export function judgeVerdictText(record: JudgeRecord): string {
	return `${judgeActionLabel(record)}, ${judgeStatText(record)}, ${record.model}`;
}

export function judgeSignalText(record: JudgeRecord): string {
	const answers = record.answers;
	const parts: string[] = [];

	if (answers.reversibility !== undefined)
		parts.push(`reversibility ${answers.reversibility.toFixed(2)}`);
	if (answers.sensitive_access !== undefined)
		parts.push(`sensitive ${answers.sensitive_access.toFixed(2)}`);
	if (record.withTasks) parts.push("saw what the session is doing and your last message");
	else if (record.withIntent) parts.push("saw your last message");

	return parts.join(", ") || "no signals";
}

export function flatten(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function oneLine(text: string, max = 60): string {
	const flat = flatten(text);
	return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}
