// Alt+T: the session's tasks over the chat, by status, with a cursor and the one under it in full.
import {
	type Decision,
	isStale,
	newestFirst,
	type SessionTasks,
	type Task,
	type TaskStatus,
	tasksWith,
} from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	colorToOkhsl,
	type Component,
	matchesKey,
	okhslColor,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export const MARKS = {
	doing: "\u2316",
	waiting: "\u2691",
	queued: "\u29d7",
	deferred: "\u21b7",
	done: "\u2713",
	dropped: "\u00d7",
	decision: "\u25c6",
} as const;

type Tint = "accent" | "warning" | "success" | "dim" | "muted" | "text" | "mdLink";

/** Each state's section title, and the tint of its title and of its mark. */
const STATUS: Record<TaskStatus, { title: string; tint: Tint; mark: Tint }> = {
	doing: { title: "Doing", tint: "accent", mark: "accent" },
	waiting: { title: "Waiting", tint: "warning", mark: "warning" },
	queued: { title: "Queued", tint: "text", mark: "muted" },
	deferred: { title: "Deferred", tint: "muted", mark: "muted" },
	done: { title: "Done", tint: "success", mark: "success" },
	dropped: { title: "Dropped", tint: "dim", mark: "dim" },
};

export interface TasksViewOptions {
	theme: Theme;
	state: () => SessionTasks;
	spent: () => { cost: number; calls: number };
	/** Rows the panel may take. */
	rows: () => number;
	close: () => void;
	requestRender: () => void;
	/** How a time reads. The local clock by default; the docs pin it, so a picture never moves. */
	clock?: Clock;
}

type Clock = (at: number) => string;

type Pick = { kind: "task"; task: Task } | { kind: "decision"; decision: Decision };

interface Line {
	text: string;
	/** The id under the line, for the cursor's highlight. */
	id?: string;
}

const PAD = 2;
const POINTER = "\u276f";
const DETAIL_LINES = 4;
const DOT = " \u00b7 ";

export class TasksView implements Component {
	readonly #options: TasksViewOptions;
	readonly #clock: Clock;
	#selected: string | undefined;
	#offset = 0;
	#dropped = false;
	#room = 0;
	#page = 10;

	constructor(options: TasksViewOptions) {
		this.#options = options;
		this.#clock = options.clock ?? localClock;
	}

	handleInput(data: string): void {
		const { close, requestRender } = this.#options;
		if (matchesKey(data, "escape") || matchesKey(data, "alt+t") || data === "q") return close();
		if (matchesKey(data, "up") || data === "k") this.#step(-1);
		else if (matchesKey(data, "down") || data === "j") this.#step(1);
		else if (matchesKey(data, "pageUp")) this.#step(-this.#page);
		else if (matchesKey(data, "pageDown")) this.#step(this.#page);
		else if (matchesKey(data, "home") || data === "g") this.#step(-Infinity);
		else if (matchesKey(data, "end") || data === "G") this.#step(Infinity);
		else if (data === "d") this.#dropped = !this.#dropped;
		else return;
		requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { theme } = this.#options;
		const state = this.#options.state();
		const picks = this.#picks(state);
		if (this.#selected === undefined || !picks.some((pick) => idOf(pick) === this.#selected))
			this.#selected = picks[0] === undefined ? undefined : idOf(picks[0]);
		const selected = picks.find((pick) => idOf(pick) === this.#selected);

		const inner = Math.max(10, width - PAD * 2);
		const body = this.#body(state, picks, inner);
		// The header, a blank line, the scroll hint, the divider, the detail pane, a blank line and the footer.
		const chrome = 6 + DETAIL_LINES;
		const most = Math.max(3, this.#options.rows() - chrome);
		// The panel never shrinks while open, so moving the cursor never moves the frame.
		this.#room = Math.min(most, Math.max(this.#room, body.length));
		const room = this.#room;
		this.#page = Math.max(1, room - 2);
		this.#follow(body, room);
		const shown = body.slice(this.#offset, this.#offset + room);
		while (shown.length < room) shown.push({ text: "" });

		// A solid card with no frame: a border's corner cells can never match the card's background.
		const mode = theme.getColorMode();
		const tones = cardTones(theme);
		const card = backgroundAnsi(tones.card, mode);
		const band = backgroundAnsi(tones.band, mode);
		const picked = theme.getBgAnsi("selectedBg");
		const pad = " ".repeat(PAD);
		const row = (text: string, background = card) =>
			`${background}${pad}${keepBackground(truncateToWidth(text, inner, "\u2026", true), background)}${pad}\x1b[49m`;
		const line = (entry: Line) =>
			row(entry.text, entry.id !== undefined && entry.id === this.#selected ? picked : card);
		return [
			row(this.#header(state, inner), band),
			row(""),
			...shown.map(line),
			row(this.#scrollHint(body.length, room)),
			row(theme.fg("borderMuted", "\u2500".repeat(inner))),
			...this.#detail(selected, inner).map((text) => row(text)),
			row(""),
			row(this.#footer(inner), band),
		];
	}

	/** What the cursor walks, in the order it is drawn. */
	#picks(state: SessionTasks): Pick[] {
		const tasks = (status: TaskStatus) => {
			const found = tasksWith(state, status);
			return status === "done" || status === "dropped" ? newestFirst(found) : found;
		};
		const statuses: TaskStatus[] = ["doing", "waiting", "queued", "deferred", "done"];
		if (this.#dropped) statuses.push("dropped");
		return [
			...statuses.flatMap((status) => tasks(status).map((task): Pick => ({ kind: "task", task }))),
			...state.decisions.toReversed().map((decision): Pick => ({ kind: "decision", decision })),
		];
	}

	#body(state: SessionTasks, picks: readonly Pick[], width: number): Line[] {
		const { theme } = this.#options;
		if (picks.length === 0)
			return [
				{ text: theme.fg("muted", "Nothing tracked yet.") },
				{ text: theme.fg("dim", "Your next message starts the list.") },
			];
		const lines: Line[] = [];
		const section = (title: string, tint: Tint, rows: Line[]) => {
			if (rows.length === 0) return;
			if (lines.length > 0) lines.push({ text: "" });
			lines.push({
				text: `${theme.bold(theme.fg(tint, title))}  ${theme.fg("dim", String(rows.length))}`,
			});
			lines.push(...rows.map((line, index) => this.#branch(line, index === rows.length - 1)));
		};
		for (const status of Object.keys(STATUS) as TaskStatus[]) {
			const rows = picks.flatMap((pick) =>
				pick.kind === "task" && pick.task.status === status
					? [this.#taskRow(pick.task, width)]
					: [],
			);
			section(STATUS[status].title, STATUS[status].tint, rows);
		}
		const decisions = picks.flatMap((pick) =>
			pick.kind === "decision" ? [this.#decisionRow(pick.decision, width)] : [],
		);
		section("Decided", "mdLink", decisions);
		return lines;
	}

	/** The tree's branch, or the pointer on the selected row. */
	#branch(line: Line, last: boolean): Line {
		const { theme } = this.#options;
		const on = line.id === this.#selected;
		const branch = on
			? theme.fg("accent", `${POINTER}  `)
			: theme.fg("border", last ? "\u2514\u2500 " : "\u251c\u2500 ");
		return { text: `${branch}${line.text}`, id: line.id };
	}

	#taskRow(task: Task, width: number): Line {
		const { theme } = this.#options;
		const closed = task.status === "done" || task.status === "dropped";
		const faded = task.id !== this.#selected && (closed || isStale(task));
		const meta = this.#meta(task);
		const mark = theme.fg(STATUS[task.status].mark, MARKS[task.status]);
		// What came out of a done task reads beside it, so the list says what the session produced.
		const aside = task.status === "done" ? task.result : undefined;
		const ink = faded ? "muted" : "text";
		return { text: this.#fit(mark, task.text, ink, meta, width, aside), id: task.id };
	}

	#decisionRow(decision: Decision, width: number): Line {
		const { theme } = this.#options;
		const meta = theme.fg("dim", this.#clock(decision.made.at));
		return {
			text: this.#fit(theme.fg("mdLink", MARKS.decision), decision.text, "text", meta, width),
			id: decision.id,
		};
	}

	/** The mark, the words and a dim aside cut to fit, and the meta flush right. */
	#fit(
		mark: string,
		words: string,
		ink: Tint,
		meta: string,
		width: number,
		aside?: string,
	): string {
		const { theme } = this.#options;
		// The branch takes three columns.
		const room = width - 3;
		const metaWidth = meta === "" ? 0 : visibleWidth(meta) + 2;
		const joined = aside === undefined ? words : `${words}${DOT}${aside}`;
		const plain = truncateToWidth(joined, Math.max(8, room - 2 - metaWidth), "\u2026");
		const rest = plain.slice(words.length);
		const head = `${mark} ${theme.fg(ink, plain.slice(0, words.length))}${theme.fg("dim", rest)}`;
		if (meta === "") return head;
		return `${head}${" ".repeat(Math.max(2, room - visibleWidth(head) - visibleWidth(meta)))}${meta}`;
	}

	#meta(task: Task): string {
		const { theme } = this.#options;
		switch (task.status) {
			case "doing":
				return task.started === undefined
					? ""
					: theme.fg("dim", `since ${this.#clock(task.started.at)}`);
			case "waiting":
				return task.waitingOn === "outside"
					? theme.fg("dim", "outside")
					: theme.fg("warning", "on you");
			case "queued":
				if (isStale(task)) return theme.fg("dim", `passed over ${task.idleRuns}\u00d7`);
				return task.origin === "agent" ? theme.fg("dim", "agent") : "";
			default:
				return task.finished === undefined ? "" : theme.fg("dim", this.#clock(task.finished.at));
		}
	}

	/** The pick under the cursor in full, in a pane of fixed height. */
	#detail(pick: Pick | undefined, width: number): string[] {
		const { theme } = this.#options;
		const lines: string[] = [];
		const add = (text: string | undefined, tint: Tint) => {
			if (text) lines.push(...wrapTextWithAnsi(theme.fg(tint, text), width));
		};
		if (pick?.kind === "decision") {
			add(pick.decision.text, "text");
			const by = pick.decision.origin === "you" ? "you decided" : "the agent decided";
			add(`${by} ${this.#clock(pick.decision.made.at)}`, "dim");
		} else if (pick?.kind === "task") {
			const { task } = pick;
			add(task.text, "text");
			add(task.result && `\u2192 ${task.result}`, "success");
			add(task.left && `left: ${task.left}`, "warning");
			add(task.why && `${reasonLabel(task)}: ${task.why}`, "muted");
			add(this.#when(task), "dim");
		}
		const kept = lines.slice(0, DETAIL_LINES);
		if (lines.length > DETAIL_LINES) kept[DETAIL_LINES - 1] = `${kept[DETAIL_LINES - 1]}\u2026`;
		while (kept.length < DETAIL_LINES) kept.push("");
		return kept;
	}

	#when(task: Task): string {
		const parts = [
			`${task.origin === "agent" ? "left by the agent" : "asked"} ${this.#clock(task.created.at)}`,
		];
		if (task.started !== undefined && task.started.at !== task.created.at)
			parts.push(`started ${this.#clock(task.started.at)}`);
		if (task.finished !== undefined) parts.push(`${task.status} ${this.#clock(task.finished.at)}`);
		if (task.asks.length > 1) parts.push(`${task.asks.length} messages`);
		return parts.join(DOT);
	}

	#step(by: number): void {
		const picks = this.#picks(this.#options.state());
		if (picks.length === 0) return;
		const at = picks.findIndex((pick) => idOf(pick) === this.#selected);
		const next = picks[Math.min(picks.length - 1, Math.max(0, (at === -1 ? 0 : at) + by))];
		this.#selected = next === undefined ? undefined : idOf(next);
	}

	/** Scrolls just enough to keep the cursor's row in view. */
	#follow(body: readonly Line[], room: number): void {
		const at = body.findIndex((line) => line.id === this.#selected);
		if (at !== -1) {
			// The section title above the first row comes into view with it.
			const top = body[at - 1]?.id === undefined ? at - 1 : at;
			if (top < this.#offset) this.#offset = Math.max(0, top);
			if (at >= this.#offset + room) this.#offset = at - room + 1;
		}
		this.#offset = Math.min(Math.max(0, this.#offset), Math.max(0, body.length - room));
	}

	#header(state: SessionTasks, width: number): string {
		const { theme } = this.#options;
		const counted: TaskStatus[] = ["doing", "waiting", "queued", "done"];
		const counts = counted
			.flatMap((status) => {
				const size = tasksWith(state, status).length;
				return size === 0 ? [] : [theme.fg(STATUS[status].mark, `${MARKS[status]} ${size}`)];
			})
			.join("  ");
		const room = Math.max(4, width - visibleWidth(counts) - 2);
		const title = theme.bold(
			theme.fg("accent", truncateToWidth(state.title ?? "This session", room, "\u2026")),
		);
		return spread(title, counts, width);
	}

	#footer(width: number): string {
		const { theme, spent } = this.#options;
		const keys = theme.fg("dim", "\u2191\u2193 move  d dropped  esc close");
		const { cost, calls } = spent();
		return spread(
			keys,
			calls === 0 ? "" : theme.fg("dim", `$${cost.toFixed(3)}, ${calls} calls`),
			width,
		);
	}

	#scrollHint(total: number, room: number): string {
		if (total <= room) return "";
		const below = total - room - this.#offset;
		return this.#options.theme.fg("dim", below > 0 ? `\u2193 ${below} more` : "\u2191 top");
	}
}

function reasonLabel(task: Task): string {
	if (task.status !== "waiting") return "why";
	return task.waitingOn === "outside" ? "on something outside" : "on you";
}

function idOf(pick: Pick): string {
	return pick.kind === "task" ? pick.task.id : pick.decision.id;
}

/** A cut line ends in a full reset, which would drop the background it sits on. */
function keepBackground(text: string, background: string): string {
	return text.replaceAll("\x1b[0m", `\x1b[0m${background}`);
}

/** The card in the border's hue, and a band a step brighter for its header and footer. */
function cardTones(theme: Theme) {
	const { h, s } = colorToOkhsl(theme.colors.border);
	return theme.appearance === "dark"
		? { card: okhslColor(h, s * 0.35, 0.14), band: okhslColor(h, s * 0.45, 0.19) }
		: { card: okhslColor(h, s * 0.3, 0.96), band: okhslColor(h, s * 0.35, 0.91) };
}

function localClock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function spread(left: string, right: string, width: number): string {
	return `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
}
