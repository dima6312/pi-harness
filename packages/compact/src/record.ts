import { isObject } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Hidden } from "./prune.ts";

export const PRUNE_ENTRY = "pi-compact:prune";
export const REREAD_ENTRY = "pi-compact:reread";
export const NOTE_MESSAGE = "pi-compact:note";

const LISTED = 12;
const GLYPH = "\u25cc";
const INDENT = "   ";

export interface PruneRecord {
	before: number;
	after: number;
	hidden: Hidden[];
	forced?: boolean;
	/** Dollars the next request pays to write the cache again. */
	rewrite?: number;
	/** Dollars each request after saves. */
	saving?: number;
}

/** The cost of the request that ran before the prune, as pi records it. */
export interface Billed {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { input: number; cacheRead: number; cacheWrite: number };
}

export interface Spent {
	prunes: number;
	freed: number;
	hidden: number;
	rereads: number;
}

export function recordOf(entry: unknown): PruneRecord | undefined {
	if (!isObject(entry) || entry.type !== "custom" || entry.customType !== PRUNE_ENTRY)
		return undefined;
	const data = entry.data;
	if (!isObject(data) || typeof data.before !== "number" || typeof data.after !== "number")
		return undefined;
	return {
		before: data.before,
		after: data.after,
		hidden: Array.isArray(data.hidden) ? (data.hidden as Hidden[]) : [],
		...(typeof data.rewrite === "number" ? { rewrite: data.rewrite } : {}),
		...(typeof data.saving === "number" ? { saving: data.saving } : {}),
	};
}

/** Priced like pi's cache-miss notice, so the two agree on screen. */
export function priced(
	billed: Billed,
	readPerMillion: number,
	freed: number,
	rewritten: number,
): { rewrite: number; saving: number } | undefined {
	const paidTokens = billed.input + billed.cacheWrite;
	const paid = paidTokens > 0 ? (billed.cost.input + billed.cost.cacheWrite) / paidTokens : 0;
	const read =
		billed.cacheRead > 0 ? billed.cost.cacheRead / billed.cacheRead : readPerMillion / 1_000_000;
	if (read === 0) return undefined;
	return { rewrite: rewritten * Math.max(0, paid - read), saving: freed * read };
}

export function spentOn(branch: readonly unknown[]): Spent {
	const spent: Spent = { prunes: 0, freed: 0, hidden: 0, rereads: 0 };
	for (const entry of branch) {
		const record = recordOf(entry);
		if (record !== undefined) {
			spent.prunes++;
			spent.freed += record.before - record.after;
			spent.hidden += record.hidden.length;
		} else if (isObject(entry) && entry.type === "custom" && entry.customType === REREAD_ENTRY)
			spent.rereads++;
	}
	return spent;
}

export function hiddenCalls(branch: readonly unknown[]): Set<string> {
	const calls = new Set<string>();
	for (const entry of branch) {
		for (const hidden of recordOf(entry)?.hidden ?? []) calls.add(hidden.call);
		if (
			isObject(entry) &&
			entry.type === "custom" &&
			entry.customType === REREAD_ENTRY &&
			isObject(entry.data)
		)
			calls.delete(String(entry.data.call));
	}
	return calls;
}

export function tokens(count: number): string {
	return count < 1000 ? String(count) : `${Math.round(count / 1000)}k`;
}

export function outputsHidden(count: number): string {
	return count === 1 ? "1 old tool output" : `${count} old tool outputs`;
}

/** Label and amount for each row of what the prune costs and saves. */
export function costRows(record: PruneRecord): [string, string][] {
	const { rewrite, saving } = record;
	if (rewrite === undefined || saving === undefined || saving < 0.005) return [];
	if (rewrite < 0.005) return [["saved on each request after", money(saving)]];
	const requests = Math.ceil(rewrite / saving);
	const back = requests === 1 ? "back in 1 request" : `back in ${requests} requests`;
	return [
		["cache rewrite on the next request", money(rewrite)],
		[`saved on each request after, ${back}`, money(saving)],
	];
}

function money(dollars: number): string {
	return dollars < 0.01 ? "under $0.01" : `~$${dollars.toFixed(2)}`;
}

/** Laid out like the judge's rulings: a glyph, a label, the detail, and numbers on the right edge. */
export class PruneEntry implements Component {
	readonly #record: PruneRecord;
	readonly #expanded: boolean;
	readonly #theme: Theme;

	constructor(record: PruneRecord, expanded: boolean, theme: Theme) {
		this.#record = record;
		this.#expanded = expanded;
		this.#theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const theme = this.#theme;
		const { before, after, hidden } = this.#record;
		// Glyph on the tool box's border column, text on its content column, numbers on its edge.
		const edge = width - 1;
		const head = ` ${theme.fg("accent", `${GLYPH} pruned`)}  `;
		const stats = `${tokens(before)} \u2192 ${tokens(after)} tokens`;
		const lines = [row(head, theme.fg("text", outputsHidden(hidden.length)), stats, edge, theme)];
		for (const [label, amount] of costRows(this.#record))
			lines.push(row(INDENT, theme.fg("muted", label), amount, edge, theme));
		if (this.#expanded) {
			const shown = hidden.slice(0, LISTED);
			for (const { call, tokens: size } of shown)
				lines.push(row(INDENT, theme.fg("muted", call), tokens(size), edge, theme));
			const more = hidden.length - shown.length;
			if (more > 0) lines.push(INDENT + theme.fg("dim", `and ${more} more`));
		}
		return lines.map((line) => truncateToWidth(line, width, "\u2026"));
	}
}

function row(head: string, detail: string, stats: string, width: number, theme: Theme): string {
	const room = width - visibleWidth(head) - visibleWidth(stats) - 1;
	const shown = truncateToWidth(detail, Math.max(8, room), "\u2026");
	const gap = Math.max(1, width - visibleWidth(head) - visibleWidth(shown) - visibleWidth(stats));
	return head + shown + " ".repeat(gap) + theme.fg("dim", stats);
}
