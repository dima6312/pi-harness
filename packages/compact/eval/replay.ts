// Plays recorded sessions through the prune and prices them, cache rewrites included.
// bun packages/compact/eval/replay.ts [--above 150000] [--days 7] [--show]
//   [--server 20]   Anthropic's clear_tool_uses, keeping the last 20 tool calls
//   [--inputs]      with clear_tool_inputs: the cleared calls lose their parameters too
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { estimateTokens, type ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";

import { type AgentMessage, pruneNow, serverClearNow, sizeAfter } from "../src/prune.ts";

const { values } = parseArgs({
	options: {
		above: { type: "string", default: "150000" },
		days: { type: "string", default: "7" },
		show: { type: "boolean", default: false },
		server: { type: "string" },
		inputs: { type: "boolean", default: false },
	},
});

interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	firstKeptEntryId?: string;
	message?: AgentMessage & {
		usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: Prices };
	};
}

type Prices = Record<"input" | "output" | "cacheRead" | "cacheWrite", number>;

const root = join(homedir(), ".pi/agent/sessions");
const since = Date.now() - Number(values.days) * 86_400_000;
const above = Number(values.above);
let real = 0;
let pruned = 0;
let rewrites = 0;
let prunes = 0;
let sessions = 0;
const rows: string[] = [];

for (const folder of readdirSync(root)) {
	for (const file of readdirSync(join(root, folder))) {
		const path = join(root, folder, file);
		if (!file.endsWith(".jsonl") || statSync(path).mtimeMs < since) continue;
		const result = replay(readBranch(path));
		if (result === undefined) continue;
		sessions++;
		real += result.real;
		pruned += result.pruned;
		rewrites += result.rewrites;
		prunes += result.prunes;
		rows.push(
			`${result.real.toFixed(2).padStart(8)} ${result.pruned.toFixed(2).padStart(8)}  ${result.prunes} prunes  ${folder}/${file.slice(0, 16)}`,
		);
	}
}

if (values.show) console.log(rows.toSorted().toReversed().join("\n"));
const saved = Math.round((1 - pruned / real) * 100);
console.log(
	`${sessions} sessions, ${values.server === undefined ? "pruning" : `server clearing (keep ${values.server})`} above ${above / 1000}k: $${real.toFixed(2)} -> $${pruned.toFixed(2)} (${saved}% less), ${prunes} prunes, cache rewrites $${rewrites.toFixed(2)}`,
);

function replay(branch: Entry[]) {
	const requests = branch.filter(
		(entry) => entry.message?.role === "assistant" && entry.message.usage,
	);
	if (requests.length < 50) return undefined;
	const price = prices(requests);
	if (price.cacheRead === 0) return undefined;

	let projected: ProjectedSessionEntry[] = [];
	let removed = 0;
	let rewriting = false;
	const cleared = new Set<string>();
	const result = { real: 0, pruned: 0, rewrites: 0, prunes: 0 };
	let last: Entry["message"];
	for (const entry of branch) {
		if (entry.type === "compaction") {
			const kept = projected.findIndex((item) => item.sourceEntry.id === entry.firstKeptEntryId);
			projected = kept === -1 ? [] : projected.slice(kept);
			removed = 0;
		}
		const message = entry.message;
		if (entry.type !== "message" || message === undefined) continue;
		const usage = message.role === "assistant" ? message.usage : undefined;
		if (usage !== undefined) {
			const context = usage.input + usage.cacheRead + usage.cacheWrite;
			const cost = (read: number, write: number) =>
				read * price.cacheRead +
				write * price.cacheWrite +
				usage.input * price.input +
				usage.output * price.output;
			result.real += cost(usage.cacheRead, usage.cacheWrite);
			if (rewriting) {
				const write = Math.max(0, context - removed - usage.input);
				result.pruned += cost(0, write);
				result.rewrites += write * (price.cacheWrite - price.cacheRead);
				rewriting = false;
			} else if (usage.cacheRead >= removed)
				result.pruned += cost(usage.cacheRead - removed, usage.cacheWrite);
			else result.pruned += cost(0, Math.max(0, usage.cacheWrite - (removed - usage.cacheRead)));
			last = message;
		}
		projected.push({ sourceEntry: entry, messages: [message] } as unknown as ProjectedSessionEntry);
		// The turn ends once its outputs are in, which is when the next request or your message starts.
		const next = branch[branch.indexOf(entry) + 1]?.message?.role;
		if (last?.usage === undefined || (next !== "assistant" && next !== "user")) continue;
		const outputs = projected
			.slice(projected.findLastIndex((item) => item.messages[0] === last) + 1)
			.reduce((sum, item) => sum + estimateTokens(item.messages[0] as AgentMessage), 0);
		const before =
			last.usage.input + last.usage.cacheRead + last.usage.cacheWrite + outputs - removed;
		const plan =
			values.server === undefined
				? pruneNow(projected, before, above)
				: serverClearNow(projected, before, above, Number(values.server), cleared, values.inputs);
		if (plan === undefined) continue;
		// The next request writes all of the context again, the system prompt too, which in fact
		// stays cached. So the saving here is a floor.
		rewriting = true;
		removed += before - sizeAfter(plan, before);
		result.prunes++;
		for (const edit of plan.edits) cleared.add(edit.targetId);
		projected = projected.map((item) => {
			const edit = plan.edits.find((candidate) => candidate.targetId === item.sourceEntry.id);
			if (edit === undefined || edit.replacement === null) return item;
			const replaced = { ...item.messages[0], content: edit.replacement.content } as AgentMessage;
			return { sourceEntry: item.sourceEntry, messages: [replaced] };
		});
	}
	return result;
}

function prices(requests: Entry[]): Prices {
	const spent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const tokens = { ...spent };
	for (const { message } of requests) {
		for (const key of Object.keys(spent) as (keyof Prices)[]) {
			spent[key] += message?.usage?.cost[key] ?? 0;
			tokens[key] += message?.usage?.[key] ?? 0;
		}
	}
	const per = (key: keyof Prices) => (tokens[key] === 0 ? 0 : spent[key] / tokens[key]);
	return {
		input: per("input"),
		output: per("output"),
		cacheRead: per("cacheRead"),
		cacheWrite: per("cacheWrite"),
	};
}

function readBranch(file: string): Entry[] {
	const entries = readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Entry);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const path: Entry[] = [];
	for (let at = entries.at(-1); at; at = at.parentId ? byId.get(at.parentId) : undefined)
		path.unshift(at);
	return path;
}
