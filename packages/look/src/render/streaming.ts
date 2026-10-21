import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// While the model writes an edit or a write, pi shows the path, or the first lines of the file,
// which stopped changing long ago. These show the end instead: the lines arriving, with a cursor
// where the model is writing, and what it has written so far on the bottom rule.
import { GLYPH, isObject, tildify } from "@adeildo/pi-kit";
import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { tabs } from "./format.ts";

/** What the frame shows inside, and the counts it adds to the bottom rule. */
export interface Stream {
	lines: string[];
	progress: string[];
}

export interface StreamContext {
	cwd: string;
	expanded: boolean;
	/** The model is still writing the call, so the cursor shows and the last key may be cut short. */
	writing: boolean;
	/** Shared by every render of one call, which keeps what was read from disk. */
	state: { streamTarget?: Target };
}

type Streamer = (args: unknown, theme: Theme, context: StreamContext) => Stream | undefined;

/** How many of the last lines a write shows while it streams. */
const WRITE_TAIL = 8;
/** How many lines of the diff an edit shows while it streams. */
const EDIT_TAIL = 10;
const CURSOR = GLYPH.cursor;
/** Larger files are not read to count their lines. */
const COUNT_LIMIT = 4 * 1024 * 1024;

export const STREAMERS: Readonly<Record<string, Streamer>> = {
	write: writeStream,
	edit: editStream,
};

/** What a write is about to replace. */
interface Target {
	path: string;
	lines?: number;
	exists: boolean;
}

export function writeStream(
	args: unknown,
	theme: Theme,
	context: StreamContext,
): Stream | undefined {
	// The model may write the content before the path, so the stream does not wait for the path.
	const content = field(args, "content");
	if (content === undefined) return undefined;
	const path = pathOf(args);

	// A path still arriving is not read: it may name another file, or a folder, on the way.
	const target =
		path !== undefined && pathSettled(args, context) ? targetOf(path, context) : undefined;
	const note = target === undefined ? "" : `  ${theme.fg("muted", replaces(target))}`;
	const lines = content.split("\n");
	const shown = context.expanded ? lines : lines.slice(-WRITE_TAIL);
	const first = lines.length - shown.length;
	const gutter = String(lines.length).length;
	const lang = path === undefined ? undefined : getLanguageFromPath(path);
	const painted = lang
		? highlightCode(shown.map(printable).join("\n"), lang)
		: shown.map((line) => theme.fg("toolOutput", printable(line)));
	const body = shown.map(
		(_, index) =>
			`${theme.fg("dim", String(first + index + 1).padStart(gutter))}  ${painted[index] ?? ""}`,
	);
	return {
		lines: [
			pathLine("write", path, theme) + note,
			...above(first, gutter, theme),
			...withCursor(body, theme, context.writing),
		],
		progress: [`${lines.length} line${lines.length === 1 ? "" : "s"}`, size(content)],
	};
}

export function editStream(
	args: unknown,
	theme: Theme,
	context: StreamContext,
): Stream | undefined {
	const path = pathOf(args);
	const edits = editsOf(args);
	if (edits.length === 0) return undefined;

	let removed = 0;
	let added = 0;
	const diff: string[] = [];
	for (const [index, edit] of edits.entries()) {
		if (index > 0) diff.push(theme.fg("dim", GLYPH.ellipsisAcross));
		// Only the last edit can still be arriving, so only the others have a known end.
		const lines = editLines(edit, !context.writing || index < edits.length - 1);
		for (const line of lines.before) diff.push(theme.fg("toolDiffContext", ` ${printable(line)}`));
		for (const line of lines.out) diff.push(theme.fg("toolDiffRemoved", `-${printable(line)}`));
		for (const line of lines.in) diff.push(theme.fg("toolDiffAdded", `+${printable(line)}`));
		for (const line of lines.after) diff.push(theme.fg("toolDiffContext", ` ${printable(line)}`));
		removed += lines.out.length;
		added += lines.in.length;
	}
	const shown = context.expanded ? diff : diff.slice(-EDIT_TAIL);
	const hidden = diff.length - shown.length;
	return {
		lines: [
			pathLine("edit", path, theme),
			...above(hidden, 0, theme),
			...withCursor(shown, theme, context.writing),
		],
		progress: [...(edits.length > 1 ? [`edit ${edits.length}`] : []), `-${removed} +${added}`],
	};
}

/**
 * The lines an edit takes out and puts in. The model repeats the lines around the change in both
 * texts, so the lines both start with, and the lines both end with once the edit is complete, are
 * context. A line the new text has not repeated yet counts as taken out until it does.
 */
export function editLines(
	edit: PartialEdit,
	complete: boolean,
): { before: string[]; out: string[]; in: string[]; after: string[] } {
	const old = edit.oldText?.split("\n") ?? [];
	const next = edit.newText?.split("\n") ?? [];
	// The last line of a text still arriving may be cut short.
	const settled = complete ? next.length : next.length - 1;
	let start = 0;
	while (start < Math.min(old.length, settled) && old[start] === next[start]) start++;
	let end = 0;
	if (complete)
		while (
			end < Math.min(old.length, next.length) - start &&
			old[old.length - 1 - end] === next[next.length - 1 - end]
		)
			end++;
	return {
		before: old.slice(0, start),
		out: old.slice(start, old.length - end),
		in: next.slice(start, next.length - end),
		after: old.slice(old.length - end),
	};
}

/** The first line pi's own renderer draws, so nothing moves when it takes over. */
function pathLine(tool: string, path: string | undefined, theme: Theme): string {
	const title = theme.fg("toolTitle", theme.bold(tool));
	// Pi's own stand-in for a path not written yet.
	if (path === undefined) return `${title} ${theme.fg("toolOutput", "...")}`;
	return `${title} ${theme.fg("accent", printable(tildify(path)))}`;
}

/**
 * A line as the terminal can print it inside the frame: a carriage return would send the cursor
 * back over the border, and a colour code or a bell in the file would reach the terminal.
 */
function printable(line: string): string {
	// oxlint-disable-next-line no-control-regex -- control characters are what this removes
	return tabs(stripTerminalSequences(line).replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, ""));
}

/** A key the model has moved past is complete, and so is every key once the call is written. */
function pathSettled(args: unknown, context: StreamContext): boolean {
	if (!context.writing || !isObject(args)) return true;
	const last = Object.keys(args).at(-1);
	return last !== "path" && last !== "file_path";
}

function above(hidden: number, gutter: number, theme: Theme): string[] {
	if (hidden <= 0) return [];
	const lines = `${hidden} line${hidden === 1 ? "" : "s"} above`;
	return [
		`${" ".repeat(Math.max(0, gutter - 1))}${theme.fg("dim", GLYPH.ellipsisUp)}  ${theme.fg("muted", lines)}`,
	];
}

function withCursor(lines: readonly string[], theme: Theme, writing: boolean): string[] {
	if (!writing || lines.length === 0) return [...lines];
	return [...lines.slice(0, -1), `${lines.at(-1)}${theme.fg("accent", CURSOR)}`];
}

function replaces(target: Target): string {
	if (!target.exists) return "new file";
	if (target.lines === undefined) return "replaces a file";
	return `replaces ${target.lines} line${target.lines === 1 ? "" : "s"}`;
}

/** Reads the file once per call, when the path is complete. */
function targetOf(path: string, context: StreamContext): Target {
	const known = context.state.streamTarget;
	if (known?.path === path) return known;
	const full = resolve(context.cwd, path);
	let target: Target = { path, exists: false };
	try {
		const info = statSync(full);
		target = { path, exists: true };
		if (info.isFile() && info.size <= COUNT_LIMIT) {
			const text = readFileSync(full, "utf8");
			target.lines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
		}
	} catch (error) {
		// A path that is not there is a new file; one that cannot be read is still a file.
		target = { path, exists: (error as NodeJS.ErrnoException).code !== "ENOENT" };
	}
	context.state.streamTarget = target;
	return target;
}

function size(text: string): string {
	const bytes = Buffer.byteLength(text);
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pathOf(args: unknown): string | undefined {
	const path = field(args, "path") ?? field(args, "file_path");
	return path === "" ? undefined : path;
}

function field(args: unknown, key: string): string | undefined {
	const value = isObject(args) ? args[key] : undefined;
	return typeof value === "string" ? value : undefined;
}

export interface PartialEdit {
	oldText?: string;
	newText?: string;
}

/** The edits written so far. The last one may have its old text and nothing else yet. */
function editsOf(args: unknown): PartialEdit[] {
	if (!isObject(args)) return [];
	const { edits } = args;
	const list = Array.isArray(edits) ? edits : [args];
	return list.flatMap((edit) => {
		const oldText = field(edit, "oldText");
		const newText = field(edit, "newText");
		return oldText === undefined && newText === undefined ? [] : [{ oldText, newText }];
	});
}
