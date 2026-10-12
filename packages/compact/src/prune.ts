import {
	type ContextEditEntryDraft,
	estimateTokens,
	type ProjectedSessionEntry,
} from "@earendil-works/pi-coding-agent";

// 10 turns did best on SWE-bench: arxiv.org/abs/2508.21433
export const KEEP_TURNS = 10;
// Each prune rewrites the prompt cache, so it waits to free this much at once.
export const MIN_FREED_SHARE = 0.4;
const MIN_OUTPUT_TOKENS = 250;
const MIN_ARGUMENT_CHARS = 1500;
const LONG_STRING = 200;
const SHOWN_CHARS = 120;
const KEPT_TOOLS = new Set(["ask_questions"]);

export interface Hidden {
	entry: string;
	call: string;
	tokens: number;
}

export interface PrunePlan {
	edits: ContextEditEntryDraft[];
	hidden: Hidden[];
	/** Estimated, like `total`: compare them, never `freed` with tokens the API reported. */
	freed: number;
	total: number;
}

export type AgentMessage = ProjectedSessionEntry["messages"][number];
type ToolCall = Extract<
	Extract<AgentMessage, { role: "assistant" }>["content"][number],
	{ type: "toolCall" }
>;
type JsonValue = ToolCall["arguments"][string];

interface Visible {
	id: string;
	message: AgentMessage;
}

export function planPrune(entries: readonly ProjectedSessionEntry[]): PrunePlan {
	const plan: PrunePlan = { edits: [], hidden: [], freed: 0, total: 0 };
	const visible = entries.flatMap(({ sourceEntry, messages }): Visible[] =>
		sourceEntry.type === "message" && messages.length === 1 && messages[0] !== undefined
			? [{ id: sourceEntry.id, message: messages[0] }]
			: [],
	);
	plan.total = visible.reduce((sum, { message }) => sum + estimateTokens(message), 0);
	const turns = visible.flatMap((entry, index) =>
		entry.message.role === "assistant" ? [index] : [],
	);
	const cutoff = turns.at(-KEEP_TURNS);
	if (turns.length <= KEEP_TURNS || cutoff === undefined) return plan;

	const calls = new Map(
		visible.flatMap(({ message }) =>
			message.role === "assistant"
				? message.content.flatMap((part) =>
						part.type === "toolCall" ? [[part.id, part] as const] : [],
					)
				: [],
		),
	);
	for (const { id, message } of visible.slice(0, cutoff)) {
		if (message.role === "toolResult") hideOutput(plan, id, message, calls.get(message.toolCallId));
		if (message.role === "assistant") cutArguments(plan, id, message);
	}
	return plan;
}

export function pruneNow(
	entries: readonly ProjectedSessionEntry[],
	contextTokens: number,
	above: number,
	forced = false,
): PrunePlan | undefined {
	if (!forced && contextTokens < above) return undefined;
	const plan = planPrune(entries);
	if (plan.edits.length === 0) return undefined;
	if (!forced && plan.freed < MIN_FREED_SHARE * plan.total) return undefined;
	return plan;
}

/** The context's size after `plan`, in the tokens the API reported for it before. */
export function sizeAfter(plan: PrunePlan, contextTokens: number): number {
	return Math.round(contextTokens - plan.freed * scale(plan, contextTokens));
}

function scale(plan: PrunePlan, contextTokens: number): number {
	return plan.total === 0 ? 0 : contextTokens / plan.total;
}

function hideOutput(
	plan: PrunePlan,
	id: string,
	message: Extract<AgentMessage, { role: "toolResult" }>,
	call: ToolCall | undefined,
): void {
	// Errors stay: without them the agent repeats what failed.
	if (message.isError || KEPT_TOOLS.has(message.toolName)) return;
	const tokens = estimateTokens(message);
	if (tokens < MIN_OUTPUT_TOKENS) return;
	const described = call === undefined ? message.toolName : describeCall(call.name, call.arguments);
	const text = `Output hidden to save context, about ${rounded(tokens)} tokens. It came from: ${described}. Run it again if you need it.`;
	const content = [{ type: "text" as const, text }];
	plan.edits.push({ type: "context_edit", targetId: id, replacement: { content } });
	plan.hidden.push({ entry: id, call: described, tokens });
	plan.freed += tokens - estimateTokens({ ...message, content });
}

function cutArguments(
	plan: PrunePlan,
	id: string,
	message: Extract<AgentMessage, { role: "assistant" }>,
): void {
	let changed = false;
	const content = message.content.map((part) => {
		if (part.type !== "toolCall" || JSON.stringify(part.arguments).length < MIN_ARGUMENT_CHARS)
			return part;
		changed = true;
		return { ...part, arguments: shortened(part.arguments) };
	});
	if (!changed) return;
	plan.edits.push({ type: "context_edit", targetId: id, replacement: { content } });
	plan.freed += estimateTokens(message) - estimateTokens({ ...message, content });
}

export function describeCall(name: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const target = [
		fields.path,
		fields.file_path,
		fields.command,
		fields.query,
		fields.url,
		fields.pattern,
	].find((value): value is string => typeof value === "string" && value.trim() !== "");
	return `${name} ${clip(target ?? JSON.stringify(fields))}`.trim();
}

function shortened(args: ToolCall["arguments"]): ToolCall["arguments"] {
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => [key, shortenedValue(value)]),
	);
}

function shortenedValue(value: JsonValue): JsonValue {
	if (typeof value === "string")
		return value.length <= LONG_STRING
			? value
			: `${clip(value)} (${value.length} characters, hidden to save context)`;
	if (Array.isArray(value)) return value.map(shortenedValue);
	if (typeof value === "object" && value !== null) return shortened(value as ToolCall["arguments"]);
	return value;
}

function clip(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length <= SHOWN_CHARS ? line : `${line.slice(0, SHOWN_CHARS - 3)}...`;
}

function rounded(tokens: number): string {
	return tokens < 1000 ? String(Math.round(tokens / 50) * 50) : `${Math.round(tokens / 100) / 10}k`;
}
