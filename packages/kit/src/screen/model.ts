import { fuzzyFilter } from "@earendil-works/pi-tui";

import type { RowView, TabView } from "../contracts/screen.ts";
import { GLYPH } from "../ui/glyphs.ts";

export type Line = { kind: "heading"; title: string } | { kind: "row"; row: RowView; tab: string };

export interface SectionMark {
	title: string;
	active: boolean;
}

export class ScreenModel {
	tabs: TabView[];
	tab = 0;
	query = "";
	#cursor: string | undefined;

	constructor(tabs: TabView[]) {
		this.tabs = tabs;
		this.#cursor = this.#firstKey();
	}

	get searching(): boolean {
		return this.query !== "";
	}

	/** Keeps the tab and the row under the cursor. */
	refresh(tabs: TabView[]): void {
		const title = this.tabs[this.tab]?.title;
		this.tabs = tabs;
		const index = tabs.findIndex((entry) => entry.title === title);
		this.tab = index === -1 ? 0 : index;
		if (this.#index() === -1) this.#cursor = this.#firstKey();
	}

	lines(): Line[] {
		return this.searching ? this.#results() : this.#tabLines();
	}

	selected(): Extract<Line, { kind: "row" }> | undefined {
		const line = this.lines()[this.#index()];
		return line?.kind === "row" ? line : undefined;
	}

	cursorLine(): number {
		return this.#index();
	}

	move(delta: number): void {
		const rows = this.#rowIndexes();
		if (rows.length === 0) return;
		const at = rows.indexOf(this.#index());
		const next = Math.min(rows.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta));
		this.#select(rows[next]);
	}

	moveToEdge(edge: "first" | "last"): void {
		const rows = this.#rowIndexes();
		this.#select(edge === "first" ? rows[0] : rows.at(-1));
	}

	jumpSection(direction: 1 | -1): void {
		const lines = this.lines();
		const starts: number[] = [];
		lines.forEach((line, index) => {
			if (line.kind === "heading" && lines[index + 1]?.kind === "row") starts.push(index + 1);
		});
		if (starts.length === 0) return;

		const at = this.#index();
		const current = starts.findLastIndex((start) => start <= at);
		const next = (current + direction + starts.length) % starts.length;
		this.#select(starts[next]);
	}

	switchTab(delta: number): void {
		if (this.searching || this.tabs.length === 0) return;
		this.tab = (this.tab + delta + this.tabs.length) % this.tabs.length;
		this.#cursor = this.#firstKey();
	}

	openTab(title: string): boolean {
		const wanted = title.trim().toLowerCase();
		const index = this.tabs.findIndex((entry) => entry.title.toLowerCase().startsWith(wanted));
		if (index === -1) return false;
		this.tab = index;
		this.#cursor = this.#firstKey();
		return true;
	}

	setQuery(query: string): void {
		this.query = query;
		this.#cursor = this.#firstKey();
	}

	sections(): SectionMark[] {
		const lines = this.lines();
		const at = this.#index();
		let active = "";
		lines.forEach((line, index) => {
			if (line.kind === "heading" && index <= at) active = line.title;
		});
		return lines
			.filter((line): line is Extract<Line, { kind: "heading" }> => line.kind === "heading")
			.map((line) => ({ title: line.title, active: line.title === active }));
	}

	#tabLines(): Line[] {
		const tab = this.tabs[this.tab];
		if (tab === undefined) return [];
		const lines: Line[] = [];
		for (const section of tab.sections) {
			const rows = tab.rows.filter((row) => row.section === section);
			if (rows.length === 0) continue;
			lines.push({ kind: "heading", title: section });
			for (const row of rows) lines.push({ kind: "row", row, tab: tab.title });
		}
		return lines;
	}

	#results(): Line[] {
		const all = this.tabs.flatMap((tab) => tab.rows.map((row) => ({ row, tab: tab.title })));
		// The query picks the rows. The order stays the tab's.
		const matched = new Set(
			fuzzyFilter(all, this.query, ({ row, tab }) =>
				[row.label, row.section, tab, row.id].join(" "),
			),
		);
		const found = all.filter((hit) => matched.has(hit));

		const groups = new Map<string, typeof found>();
		for (const hit of found) {
			const title = `${hit.tab} ${GLYPH.chevron} ${hit.row.section}`;
			groups.set(title, [...(groups.get(title) ?? []), hit]);
		}
		const lines: Line[] = [];
		for (const [title, hits] of groups) {
			lines.push({ kind: "heading", title });
			for (const hit of hits) lines.push({ kind: "row", ...hit });
		}
		return lines;
	}

	#rowIndexes(): number[] {
		const indexes: number[] = [];
		this.lines().forEach((line, index) => {
			if (line.kind === "row") indexes.push(index);
		});
		return indexes;
	}

	#index(): number {
		if (this.#cursor === undefined) return -1;
		return this.lines().findIndex(
			(line) => line.kind === "row" && keyOf(line.row) === this.#cursor,
		);
	}

	#select(index: number | undefined): void {
		if (index === undefined) return;
		const line = this.lines()[index];
		if (line?.kind === "row") this.#cursor = keyOf(line.row);
	}

	#firstKey(): string | undefined {
		const line = this.lines().find((entry) => entry.kind === "row");
		return line?.kind === "row" ? keyOf(line.row) : undefined;
	}
}

export function keyOf(row: RowView): string {
	return `${row.feature}\u0000${row.id}`;
}
