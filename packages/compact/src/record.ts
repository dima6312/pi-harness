import { isObject } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

import type { Hidden } from "./prune.ts";

export const PRUNE_ENTRY = "pi-compact:prune";
export const REREAD_ENTRY = "pi-compact:reread";
export const NOTE_MESSAGE = "pi-compact:note";

const LISTED = 12;

export interface PruneRecord {
	before: number;
	after: number;
	hidden: Hidden[];
	forced?: boolean;
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
	};
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

export function pruneLine(record: PruneRecord): string {
	const outputs =
		record.hidden.length === 1 ? "1 old tool output" : `${record.hidden.length} old tool outputs`;
	return `Hid ${outputs} to save context: ${tokens(record.before)} \u2192 ${tokens(record.after)} tokens`;
}

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
		const lines = [`${theme.fg("dim", "\u2702 ")}${theme.fg("muted", pruneLine(this.#record))}`];
		if (this.#expanded) {
			const shown = this.#record.hidden.slice(0, LISTED);
			lines.push(
				...shown.map((hidden) => theme.fg("dim", `  ${hidden.call}  ${tokens(hidden.tokens)}`)),
			);
			const more = this.#record.hidden.length - shown.length;
			if (more > 0) lines.push(theme.fg("dim", `  and ${more} more`));
		}
		return lines.map((line) => truncateToWidth(line, width, "\u2026"));
	}
}
