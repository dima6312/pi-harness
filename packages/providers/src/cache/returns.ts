// A refresh between runs pays only if you come back before the next one, so this learns that
// chance from the session files: how long the end of each run waited for the next request.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Half-minute buckets for the first hour. The last one holds longer waits and runs never answered. */
const BUCKET_MINUTES = 0.5;
const BUCKETS = 121;
export const LEARN_DAYS = 30;
/** With fewer runs than this still waiting at a time, the chance after it is noise. */
const MIN_WAITING = 40;

export interface Returns {
	/** The run ended on a question to you. */
	asked: number[];
	other: number[];
}

export interface Wait {
	minutes: number;
	asked: boolean;
}

/** The runs the table below was measured on. */
export const MEASURED_RUNS = 1688;

/**
 * The chance of a message in the 4.5 minutes after a refresh, for refreshes sent less than `until`
 * minutes after the last request, measured on `MEASURED_RUNS` runs. Used until enough is learned.
 */
const MEASURED: readonly (readonly [until: number, chance: number])[] = [
	[9, 0.28],
	[13.5, 0.12],
	[18, 0.074],
	[22.5, 0.06],
	[31.5, 0.035],
];
const MEASURED_LATER = 0.015;

export function emptyReturns(): Returns {
	return { asked: zeros(), other: zeros() };
}

/** Whether counts read back from disk have the buckets this version uses. */
export function isReturns(value: Partial<Returns>): value is Returns {
	return value.asked?.length === BUCKETS && value.other?.length === BUCKETS;
}

export function addWait(returns: Returns, wait: Wait): void {
	const bucket = Math.min(BUCKETS - 1, Math.floor(wait.minutes / BUCKET_MINUTES));
	(wait.asked ? returns.asked : returns.other)[bucket]! += 1;
}

export function runsIn(returns: Returns): number {
	return sum(returns.asked) + sum(returns.other);
}

/** Chance of a message in the `window` minutes after `minutes` away, given none came before. */
export function returnChance(
	returns: Returns | undefined,
	minutes: number,
	window: number,
	asked: boolean,
): number {
	if (returns !== undefined) {
		const own = chanceIn(asked ? returns.asked : returns.other, minutes, window);
		if (own !== undefined) return own;
		const both = returns.asked.map((count, bucket) => count + returns.other[bucket]!);
		const all = chanceIn(both, minutes, window);
		if (all !== undefined) return all;
	}
	return MEASURED.find(([until]) => minutes < until)?.[1] ?? MEASURED_LATER;
}

function chanceIn(counts: readonly number[], minutes: number, window: number): number | undefined {
	const from = Math.min(BUCKETS - 1, Math.floor(minutes / BUCKET_MINUTES));
	const to = Math.min(BUCKETS - 1, Math.floor((minutes + window) / BUCKET_MINUTES));
	const waiting = sum(counts.slice(from));
	if (waiting < MIN_WAITING) return undefined;
	return sum(counts.slice(from, to)) / waiting;
}

/**
 * The waits in one session file. A run ends on an assistant message without tool calls, and its
 * wait lasts until the next request; a run nothing followed waited forever.
 */
export function waitsIn(file: string, since: number): Wait[] {
	const requests: { timestamp: number; ends: boolean; asked: boolean }[] = [];
	for (const line of file.split("\n")) {
		// Most lines are tool output; this skips them without parsing.
		if (!line.includes('"role":"assistant"')) continue;
		const message = assistantOf(line);
		if (message !== undefined && message.timestamp >= since) requests.push(message);
	}
	return requests.flatMap((request, index) => {
		if (!request.ends) return [];
		const next = requests[index + 1];
		const minutes = next === undefined ? Infinity : (next.timestamp - request.timestamp) / 60_000;
		return [{ minutes, asked: request.asked }];
	});
}

interface Part {
	type?: string;
	text?: string;
}

/** A line of a session file, as far as this reads it. */
interface Line {
	type?: string;
	message?: { role?: string; timestamp?: unknown; usage?: unknown; content?: unknown };
}

/** A request the agent made, from its line. Undefined for any other line. */
function assistantOf(
	line: string,
): { timestamp: number; ends: boolean; asked: boolean } | undefined {
	const message = parse(line)?.message;
	if (message?.role !== "assistant" || message.usage === undefined) return undefined;
	if (typeof message.timestamp !== "number") return undefined;
	const content: Part[] = Array.isArray(message.content) ? message.content : [];
	return {
		timestamp: message.timestamp,
		ends: !content.some((part) => part.type === "toolCall"),
		asked: endsOnQuestion(content),
	};
}

function parse(line: string): Line | undefined {
	try {
		const entry = JSON.parse(line) as Line;
		return entry.type === "message" ? entry : undefined;
	} catch {
		return undefined;
	}
}

/** Whether the agent's last words were a question to you. */
export function endsOnQuestion(content: readonly Part[]): boolean {
	const texts = content
		.filter((part) => part.type === "text")
		.map((part) => part.text?.trim() ?? "");
	return texts.findLast((text) => text !== "")?.endsWith("?") ?? false;
}

/**
 * Reads every session file changed in the last `LEARN_DAYS`. One file at a time, so a month of
 * sessions is never in memory at once.
 */
export async function learnReturns(root: string, now: number): Promise<Returns> {
	const since = now - LEARN_DAYS * 86_400_000;
	const returns = emptyReturns();
	for (const folder of await readdir(root).catch(() => [])) {
		const dir = join(root, folder);
		// oxlint-disable-next-line no-await-in-loop -- one file at a time
		for (const name of await readdir(dir).catch(() => [])) {
			if (!name.endsWith(".jsonl")) continue;
			const path = join(dir, name);
			// oxlint-disable-next-line no-await-in-loop -- as above
			const changed = await stat(path).then(
				(info) => info.mtimeMs,
				() => 0,
			);
			if (changed < since) continue;
			// oxlint-disable-next-line no-await-in-loop -- as above
			const file = await readFile(path, "utf8").catch(() => "");
			for (const wait of waitsIn(file, since)) addWait(returns, wait);
		}
	}
	return returns;
}

function zeros(): number[] {
	return Array.from({ length: BUCKETS }, () => 0);
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
