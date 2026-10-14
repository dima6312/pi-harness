import { tasksUsageOf } from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

export interface RequestRecord {
	output: number;
	prompt: number;
	firstTokenMs: number;
	generationMs: number;
}

export const REQUEST_ENTRY = "pi-look:request";
/** Written by this package before it was renamed. It has no `prompt`, so it only counts for decode. */
const LEGACY_ENTRY = "pi-statusline:turn";

export interface Averages {
	decode: number | undefined;
	prefill: number | undefined;
}

export function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function promptOf(totals: Totals): number {
	return totals.input + totals.cacheRead + totals.cacheWrite;
}

export function tokensOf(totals: Totals): number {
	return promptOf(totals) + totals.output;
}

export function usageTotals(usage: UsageLike): Totals {
	const totals = emptyTotals();
	add(totals, usage);
	return totals;
}

export function totalsOf(entries: readonly SessionEntry[]): Totals {
	const totals = emptyTotals();

	for (const entry of entries) {
		if (entry.type === "usage") add(totals, entry.usage);
		else if (entry.type === "message" && entry.message.role === "assistant")
			add(totals, entry.message.usage);
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage)
			add(totals, entry.message.usage);
		else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage)
			add(totals, entry.usage);
		else if (entry.type === "custom") addTasks(totals, tasksUsageOf(entry));
	}

	return totals;
}

/** The usage of the last answer the model gave, which is what the cache lines talk about. */
function lastAssistantUsage(entries: readonly SessionEntry[]): UsageLike | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		return entry.message.usage;
	}
	return undefined;
}

export function cacheHitPercent(entries: readonly SessionEntry[]): number | undefined {
	const usage = lastAssistantUsage(entries);
	if (usage === undefined) return undefined;
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	return prompt === 0 ? undefined : (usage.cacheRead / prompt) * 100;
}

export function cacheWarming(entries: readonly SessionEntry[]): boolean {
	const usage = lastAssistantUsage(entries);
	return usage !== undefined && usage.cacheRead === 0 && usage.cacheWrite > 0;
}

export function averagesOf(entries: readonly SessionEntry[]): Averages {
	let output = 0;
	let generationMs = 0;
	let prompt = 0;
	let waitingMs = 0;

	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType !== REQUEST_ENTRY && entry.customType !== LEGACY_ENTRY) continue;
		const record = entry.data;
		if (!isRecord(record)) continue;

		output += record.output;
		generationMs += record.generationMs;
		if (typeof record.prompt === "number" && record.prompt > 0) {
			prompt += record.prompt;
			waitingMs += record.firstTokenMs;
		}
	}

	return { decode: perSecond(output, generationMs), prefill: perSecond(prompt, waitingMs) };
}

export function perSecond(tokens: number, milliseconds: number): number | undefined {
	return tokens > 0 && milliseconds > 0 ? tokens / (milliseconds / 1000) : undefined;
}

function isRecord(
	data: unknown,
): data is Omit<RequestRecord, "prompt"> & { prompt?: number | undefined } {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Partial<RequestRecord>;
	return (
		typeof record.output === "number" &&
		typeof record.firstTokenMs === "number" &&
		typeof record.generationMs === "number"
	);
}

// The tasks package's model calls are not pi's, so pi does not count them. They count here.
function addTasks(totals: Totals, usage: ReturnType<typeof tasksUsageOf>): void {
	if (usage === undefined) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cost += usage.cost;
}

function add(totals: Totals, usage: UsageLike): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}
