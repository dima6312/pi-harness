import { drawnByWidth, ENTRY_X, entryFrame, type FeatureScope, GLYPH } from "@adeildo/pi-kit";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { flatten, judgeActionLabel, judgeSignalText, judgeStatText } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

const JUDGE_ENTRY = `${NAME}:judge`;

const MIN_TARGET = 12;

interface Columns {
	action: number;
	tool: number;
}

export function registerJudgeEntry(scope: FeatureScope): void {
	scope.registerEntryRenderer<unknown>(JUDGE_ENTRY, (entry, { expanded }, theme) => {
		const records = toRecords(entry.data);
		if (records.length === 0) return undefined;
		const card = new JudgeEntry(records, expanded, theme);
		return drawnByWidth((width) => card.render(width));
	});
}

/** Old sessions hold one record per entry, newer ones an array. */
export function toRecords(data: unknown): JudgeRecord[] {
	const list = Array.isArray(data) ? data : [data];
	return list.filter(isJudgeRecord);
}

function isJudgeRecord(value: unknown): value is JudgeRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<JudgeRecord>;
	return typeof record.summary === "string" && typeof record.toolName === "string";
}

/** Written when the judge answers, so the card shows before the call runs. */
export function appendJudgeEntry(pi: ExtensionAPI, record: JudgeRecord): void {
	pi.appendEntry(JUDGE_ENTRY, [record]);
}

class JudgeEntry implements Component {
	constructor(
		private readonly records: JudgeRecord[],
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	/** A throw here kills the whole TUI, so a drifted entry degrades to a stub. */
	render(width: number): string[] {
		try {
			return this.build(width);
		} catch {
			return [this.theme.fg("dim", `${NAME} judge: unreadable entry`)];
		}
	}

	/** In a frame named judge, one row per decision. */
	private build(width: number): string[] {
		const lines: string[] = [];
		const columns = this.columns();
		const inner = width - ENTRY_X;

		for (const record of this.records) {
			lines.push(this.row(record, inner, columns));
			if (!this.expanded) continue;
			lines.push(`  ${this.theme.fg("dim", record.reason)}`);
			lines.push(`  ${this.theme.fg("dim", judgeSignalText(record))}`);
		}

		const count = this.records.length > 1 ? `${this.records.length} decisions` : undefined;
		return entryFrame(lines, width, this.theme, {
			top: `${this.theme.fg("muted", GLYPH.judge)} ${this.theme.fg("muted", "judge")}`,
			topRight: count === undefined ? undefined : this.theme.fg("dim", count),
			color: "borderMuted",
		});
	}

	/** From this card's records only, plus one column so a field never touches the next. */
	private columns(): Columns {
		const action = Math.max(...this.records.map((r) => judgeActionLabel(r).length));
		const tool = Math.max(...this.records.map((r) => r.toolName.length));
		return { action: action + 1, tool: tool + 1 };
	}

	/** Stats hug the right edge, so the target uses whatever room is left. */
	private row(record: JudgeRecord, width: number, columns: Columns): string {
		const tone = toneFor(record);
		const action = judgeActionLabel(record).padEnd(columns.action);
		const tool = record.toolName.padEnd(columns.tool);
		const stats = judgeStatText(record);

		const head = `${action}${tool}`;
		const room = width - visibleWidth(head) - visibleWidth(stats) - 1;
		const target = truncateToWidth(flatten(record.summary), Math.max(MIN_TARGET, room), "...");
		const gap = Math.max(
			1,
			width - visibleWidth(head) - visibleWidth(target) - visibleWidth(stats),
		);

		return (
			this.theme.fg(tone, action) +
			this.theme.fg("muted", tool) +
			this.theme.fg("text", target) +
			" ".repeat(gap) +
			this.theme.fg("dim", stats)
		);
	}
}

function toneFor(record: JudgeRecord): "success" | "error" | "warning" {
	if (record.error) return "warning";
	if (record.action === "allow") return "success";
	if (record.action === "deny") return "error";
	return "warning";
}
