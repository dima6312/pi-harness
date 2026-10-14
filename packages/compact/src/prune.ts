import { callTarget } from "@adeildo/pi-kit";
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
export const KEPT_TOOLS = ["ask_questions"];
const SERVER_PLACEHOLDER = "[cleared]";

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

interface Visible {
	id: string;
	message: AgentMessage;
}

export function planPrune(entries: readonly ProjectedSessionEntry[]): PrunePlan {
	const visible = visibleOf(entries);
	const plan: PrunePlan = { edits: [], hidden: [], freed: 0, total: totalOf(visible) };
	const turns = visible.flatMap((entry, index) =>
		entry.message.role === "assistant" ? [index] : [],
	);
	const cutoff = turns.at(-KEEP_TURNS);
	if (turns.length <= KEEP_TURNS || cutoff === undefined) return plan;

	const calls = callsOf(visible);
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

/**
 * What Anthropic's `clear_tool_uses` takes out when it runs: every tool result but the last
 * `keep`, errors too, leaving the calls. `cleared` are the entries it took out before.
 */
export function planServerClear(
	entries: readonly ProjectedSessionEntry[],
	keep: number,
	cleared: ReadonlySet<string> = new Set(),
	inputs = false,
): PrunePlan {
	const visible = visibleOf(entries);
	const plan: PrunePlan = { edits: [], hidden: [], freed: 0, total: totalOf(visible) };
	const calls = callsOf(visible);
	const results = visible.filter(
		({ message }) => message.role === "toolResult" && !KEPT_TOOLS.includes(message.toolName),
	);
	for (const { id, message } of results.slice(0, Math.max(0, results.length - keep))) {
		if (message.role !== "toolResult" || cleared.has(id)) continue;
		const call = calls.get(message.toolCallId);
		const tokens = estimateTokens(message);
		const content = [{ type: "text" as const, text: SERVER_PLACEHOLDER }];
		plan.edits.push({ type: "context_edit", targetId: id, replacement: { content } });
		plan.hidden.push({
			entry: id,
			call: call === undefined ? message.toolName : describeCall(call.name, call.arguments),
			tokens,
		});
		plan.freed += tokens - estimateTokens({ ...message, content });
		// estimateTokens counts four characters a token.
		if (inputs && call !== undefined) plan.freed += JSON.stringify(call.arguments).length / 4;
	}
	return plan;
}

/** The server clears only past `above`, and only when it frees `clearAtLeast` real tokens. */
export function serverClearNow(
	entries: readonly ProjectedSessionEntry[],
	contextTokens: number,
	above: number,
	keep: number,
	cleared: ReadonlySet<string> = new Set(),
	inputs = false,
): PrunePlan | undefined {
	if (contextTokens < above) return undefined;
	const plan = planServerClear(entries, keep, cleared, inputs);
	if (plan.freed * scale(plan, contextTokens) < clearAtLeast(above)) return undefined;
	return plan;
}

export function clearAtLeast(above: number): number {
	return Math.round(MIN_FREED_SHARE * above);
}

/** The context's size after `plan`, in the tokens the API reported for it before. */
export function sizeAfter(plan: PrunePlan, contextTokens: number): number {
	return Math.round(contextTokens - plan.freed * scale(plan, contextTokens));
}

function visibleOf(entries: readonly ProjectedSessionEntry[]): Visible[] {
	return entries.flatMap(({ sourceEntry, messages }): Visible[] =>
		sourceEntry.type === "message" && messages.length === 1 && messages[0] !== undefined
			? [{ id: sourceEntry.id, message: messages[0] }]
			: [],
	);
}

function totalOf(visible: readonly Visible[]): number {
	return visible.reduce((sum, { message }) => sum + estimateTokens(message), 0);
}

function callsOf(visible: readonly Visible[]): Map<string, ToolCall> {
	return new Map(
		visible.flatMap(({ message }) =>
			message.role === "assistant"
				? message.content.flatMap((part) =>
						part.type === "toolCall" ? [[part.id, part] as const] : [],
					)
				: [],
		),
	);
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
	if (message.isError || KEPT_TOOLS.includes(message.toolName)) return;
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
	const target = callTarget(args);
	return `${name} ${clip(target === "" ? JSON.stringify(args ?? {}) : target)}`.trim();
}

/**
 * An old call without its long arguments, and a note on what went. The model copies what it sees
 * in its context: a value cut short with a note in it once taught it to cut its own arguments,
 * and the call ran with them cut. A value that is gone makes a copied call fail, out loud.
 */
function shortened(args: ToolCall["arguments"]): ToolCall["arguments"] {
	const kept: ToolCall["arguments"] = {};
	const gone: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		const size = typeof value === "string" ? value.length : JSON.stringify(value).length;
		if (size <= LONG_STRING) kept[key] = value;
		else gone.push(`${key} (${size} characters)`);
	}
	return {
		...kept,
		[PRUNED_KEY]: `Removed from the context to save space: ${gone.join(", ")}. The call ran with them in full.`,
	};
}

/** The key of the note an old call carries in place of its long arguments. */
export const PRUNED_KEY = "_pruned";
/** How cut values read before: an agent that saw them wrote its own arguments that way. */
const OLD_MARKER = /characters, hidden to save context\)/u;

/**
 * Why a call must not run: it carries a pruned call's note, or a value cut the old way, which
 * means the model copied a pruned call instead of writing its arguments.
 */
export function copiedPrune(args: unknown): string | undefined {
	if (typeof args === "string") return OLD_MARKER.test(args) ? "a value cut short" : undefined;
	if (Array.isArray(args)) return args.map(copiedPrune).find((reason) => reason !== undefined);
	if (typeof args !== "object" || args === null) return undefined;
	if (PRUNED_KEY in args) return `the ${PRUNED_KEY} note of a pruned call`;
	return Object.values(args)
		.map(copiedPrune)
		.find((reason) => reason !== undefined);
}

function clip(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length <= SHOWN_CHARS ? line : `${line.slice(0, SHOWN_CHARS - 3)}...`;
}

function rounded(tokens: number): string {
	return tokens < 1000 ? String(Math.round(tokens / 50) * 50) : `${Math.round(tokens / 100) / 10}k`;
}
