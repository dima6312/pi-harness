// Why a request wrote the prompt cache again instead of reading it, from the session's own entries.
// A request reads the cache up to where the last one wrote it, as long as nothing before that point
// changed and the cache was still alive. So each miss has one of a few causes, and the entries
// between it and the request before it say which.
import { formatCost, formatTokens, PRUNE_ENTRY } from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** A request that wrote at least this much again counts as a miss: a turn only writes its tail. */
export const MISS_TOKENS = 30_000;
/** How long Anthropic keeps a prompt cached when nothing reads it. */
export const CACHE_LIFE_MS = 5 * 60_000;
/** A context smaller than the request before by this much was cut, by a prune or a server clear. */
const SHRANK = 5_000;

export type MissCause =
	| "first request"
	| "model changed"
	| "compaction"
	| "prune"
	| "server clear"
	| "pause"
	| "prompt changed"
	| "other";

export interface Miss {
	at: number;
	cause: MissCause;
	/** Tokens written again. */
	written: number;
	/** The whole prompt of the request. */
	prompt: number;
	/** The prompt of the request before. */
	before: number | undefined;
	/** Minutes since the cache was last used, by a request or a warming refresh. */
	idleMinutes: number;
}

interface Answer {
	at: number;
	model: string;
	written: number;
	prompt: number;
}

/** Every miss on the branch, oldest first. */
export function missesOf(branch: readonly SessionEntry[]): Miss[] {
	const misses: Miss[] = [];
	let last: Answer | undefined;
	let usedAt: number | undefined;
	let between: SessionEntry[] = [];
	for (const entry of branch) {
		const answer = answerOf(entry);
		if (answer === undefined) {
			if (entry.type === "usage") usedAt = Date.parse(entry.timestamp);
			between.push(entry);
			continue;
		}
		if (answer.written >= MISS_TOKENS) {
			const idle = usedAt === undefined ? 0 : answer.at - usedAt;
			misses.push({
				at: answer.at,
				cause: causeOf(answer, last, between, idle),
				written: answer.written,
				prompt: answer.prompt,
				before: last?.prompt,
				idleMinutes: Math.round(idle / 60_000),
			});
		}
		last = answer;
		usedAt = answer.at;
		between = [];
	}
	return misses;
}

function causeOf(
	answer: Answer,
	last: Answer | undefined,
	between: readonly SessionEntry[],
	idle: number,
): MissCause {
	if (last === undefined) return "first request";
	if (answer.model !== last.model) return "model changed";
	if (between.some((entry) => entry.type === "compaction")) return "compaction";
	const pruned = between.some(
		(entry) =>
			entry.type === "context_edit" ||
			(isPrune(entry) && (entry.data as { server?: boolean } | undefined)?.server !== true),
	);
	if (pruned) return "prune";
	if (between.some(isPrune) || last.prompt - answer.prompt >= SHRANK) return "server clear";
	if (idle > CACHE_LIFE_MS) return "pause";
	if (between.some(isSystemMessage)) return "prompt changed";
	return "other";
}

function answerOf(entry: SessionEntry): Answer | undefined {
	if (entry.type !== "message" || entry.message.role !== "assistant") return undefined;
	const { usage, provider, model, stopReason } = entry.message;
	if (stopReason === "error" || stopReason === "aborted") return undefined;
	return {
		at: Date.parse(entry.timestamp),
		model: `${provider}/${model}`,
		written: usage.cacheWrite,
		prompt: usage.input + usage.cacheRead + usage.cacheWrite,
	};
}

function isPrune(entry: SessionEntry): entry is Extract<SessionEntry, { type: "custom" }> {
	return entry.type === "custom" && entry.customType === PRUNE_ENTRY;
}

function isSystemMessage(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message.role === "system";
}

/** What writing `tokens` again cost over reading them, in dollars, at prices per million. */
export function extraCost(
	tokens: number,
	prices: { cacheRead: number; cacheWrite: number },
): number {
	return (tokens * Math.max(0, prices.cacheWrite - prices.cacheRead)) / 1_000_000;
}

/** One line for the session: how many misses, what they cost, and their causes, biggest first. */
export function missesSummary(
	misses: readonly Miss[],
	prices: { cacheRead: number; cacheWrite: number } | undefined,
): string {
	if (misses.length === 0) return "none yet: every request read what the one before wrote";
	const written = misses.reduce((sum, miss) => sum + miss.written, 0);
	const byCause = new Map<MissCause, number>();
	for (const miss of misses) byCause.set(miss.cause, (byCause.get(miss.cause) ?? 0) + miss.written);
	const causes = [...byCause]
		.toSorted(([, a], [, b]) => b - a)
		.map(([cause]) => {
			const count = misses.filter((miss) => miss.cause === cause).length;
			return `${count} ${count === 1 ? cause : PLURAL[cause]}`;
		});
	const cost =
		prices === undefined ? "" : `, ${formatCost(extraCost(written, prices))} over reading them`;
	const count = misses.length === 1 ? "1 miss" : `${misses.length} misses`;
	return `${count} wrote ${formatTokens(written)} tokens again${cost}: ${causes.join(", ")}`;
}

/** One miss: its cause, what it wrote again and what that cost, and the detail that shows the cause. */
export function missLine(
	miss: Miss,
	prices: { cacheRead: number; cacheWrite: number } | undefined,
): string {
	const cost = prices === undefined ? "" : `, ${formatCost(extraCost(miss.written, prices))}`;
	return `${miss.cause}: ${formatTokens(miss.written)} written again${cost}${DETAIL[miss.cause](miss)}`;
}

const PLURAL: Record<MissCause, string> = {
	"first request": "first requests",
	"model changed": "model changes",
	compaction: "compactions",
	prune: "prunes",
	"server clear": "server clears",
	pause: "pauses",
	"prompt changed": "prompt changes",
	other: "other",
};

const DETAIL: Record<MissCause, (miss: Miss) => string> = {
	"first request": () => "",
	"model changed": () => "",
	compaction: () => "",
	prune: (miss) => shrank(miss),
	"server clear": (miss) => shrank(miss),
	pause: (miss) => ` after ${miss.idleMinutes} min away`,
	"prompt changed": () => " (system prompt or tools)",
	other: () => "",
};

function shrank(miss: Miss): string {
	return miss.before === undefined
		? ""
		: ` (context ${formatTokens(miss.before)} to ${formatTokens(miss.prompt)})`;
}
