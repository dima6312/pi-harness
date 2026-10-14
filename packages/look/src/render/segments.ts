import { type AccountWindow, type PeerMark, tasksWith } from "@adeildo/pi-kit";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { Snapshot } from "../data/snapshot.ts";
import { promptOf, tokensOf, type Totals } from "../data/totals.ts";
import type { Piece } from "./fit.ts";
import {
	basename,
	CELL,
	cell,
	count,
	fitWidth,
	gauge,
	latency,
	money,
	percent,
	rate,
	shortenPath,
	stopwatch,
	UNKNOWN,
} from "./format.ts";
import type { Glyphs } from "./glyphs.ts";
import { EFFORT_LEVELS, type Paint, type Role } from "./paint.ts";

export const SEGMENT_IDS = [
	"path",
	"branch",
	"host",
	"session",
	"tasks",
	"peers",
	"version",
	"clock",
	"provider",
	"model",
	"effort",
	"context",
	"speed",
	"wait",
	"server",
	"elapsed",
	"last",
	"request",
	"costRate",
	"cost",
	"quota",
	"tokens",
	"cache",
	"average",
	"statuses",
] as const;

export type BuiltinSegment = (typeof SEGMENT_IDS)[number];
export type StatusSegment = `status:${string}`;
export type SegmentId = BuiltinSegment | StatusSegment;

const STATUS_PREFIX = "status:";
const STATUS_PRIORITY = 95;

export function isSegmentId(value: string): value is SegmentId {
	return (
		(SEGMENT_IDS as readonly string[]).includes(value) ||
		(value.startsWith(STATUS_PREFIX) && value.length > STATUS_PREFIX.length)
	);
}

/** Status keys a builtin segment already draws, so the statuses segment skips them. */
const CLAIMED_BY_SEGMENT: Partial<Record<BuiltinSegment, string>> = {
	model: "pi-providers:account",
	tasks: "pi-tasks",
	peers: "pi-peers",
};

export function claimedStatuses(slots: readonly (readonly SegmentId[])[]): Set<string> {
	const claimed = new Set<string>();
	for (const ids of slots) {
		for (const id of ids) {
			if (id.startsWith(STATUS_PREFIX)) claimed.add(id.slice(STATUS_PREFIX.length));
			const bySegment = CLAIMED_BY_SEGMENT[id as BuiltinSegment];
			if (bySegment !== undefined) claimed.add(bySegment);
		}
	}
	return claimed;
}

export interface SegmentOptions {
	pathLength: number;
	gaugeCells: number;
	claimed: ReadonlySet<string>;
	labels: boolean;
}

export interface SegmentInput {
	snapshot: Snapshot;
	glyphs: Glyphs;
	paint: Paint;
	options: SegmentOptions;
}

type Rendered = Omit<Piece, "priority"> | undefined;

interface Segment {
	priority: number;
	describe: string;
	render(input: SegmentInput): Rendered;
}

export const SEGMENTS: Record<BuiltinSegment, Segment> = {
	path: {
		priority: 70,
		describe: "the working folder, with home as ~",
		render: ({ snapshot, glyphs, paint, options }) => {
			if (snapshot.cwd === "") return undefined;
			const full = shortenPath(snapshot.cwd, snapshot.home, options.pathLength);
			const icon = mark(glyphs.folder, paint, "path");
			return {
				text: `${icon}${paint.role("path", full)}`,
				compact: `${icon}${paint.role("path", basename(snapshot.cwd))}`,
			};
		},
	},
	branch: {
		priority: 82,
		describe:
			"the git branch: ↑ commits ahead, ↓ behind, + staged, ~ modified, ? untracked, ! conflicts, then stashes",
		render: ({ snapshot, glyphs, paint }) => {
			if (snapshot.branch === null) return undefined;
			const icon = mark(glyphs.branch, paint, "branch");
			const detached = snapshot.branch === "detached";
			const name = detached
				? paint.role("behind", "detached")
				: paint.role("branch", fitWidth(snapshot.branch, 32, glyphs.ellipsis));
			const git = snapshot.git;
			if (git === undefined) return { text: `${icon}${name}` };

			const marks = [
				counted(git.ahead, glyphs.ahead, "ahead", paint),
				counted(git.behind, glyphs.behind, "behind", paint),
				counted(git.staged, glyphs.staged, "staged", paint),
				counted(git.modified, glyphs.modified, "modified", paint),
				counted(git.untracked, glyphs.untracked, "untracked", paint),
				counted(git.conflicted, glyphs.conflicted, "conflicted", paint),
				counted(git.stashed, glyphs.stashed, "untracked", paint),
			].filter((part) => part !== "");
			const dirty = git.staged + git.modified + git.untracked + git.conflicted > 0;
			return {
				text: marks.length === 0 ? `${icon}${name}` : `${icon}${name} ${marks.join(" ")}`,
				compact: dirty ? `${icon}${name}${paint.role("modified", "*")}` : `${icon}${name}`,
			};
		},
	},
	host: {
		priority: 20,
		describe: "the machine, so a pasted line says where it came from",
		render: ({ snapshot, glyphs, paint }) =>
			snapshot.host === undefined || snapshot.host === ""
				? undefined
				: { text: `${mark(glyphs.host, paint, "host")}${paint.role("host", snapshot.host)}` },
	},
	peers: {
		priority: 25,
		describe:
			"the other agents in this folder, each by the name it chose and in its colour, then @ how many messages wait for an answer",
		// The whole folder, then one name, then the bare mark, as the line runs out of room.
		render: ({ snapshot, glyphs, paint }) => {
			const peers = snapshot.peers;
			const mentions =
				snapshot.peersUnread > 0 ? paint.role("waiting", `@${snapshot.peersUnread}`) : "";
			const first = peers[0];
			if (first === undefined) return mentions === "" ? undefined : { text: mentions };
			const named = (peer: PeerMark) => paint.raw(peer.color, `${glyphs.peers} ${peer.handle}`);
			const rest = peers.length > 1 ? paint.dim(` +${peers.length - 1}`) : "";
			const full = joined([...peers].map(named).join("  "), mentions);
			const short = joined(named(first) + rest, mentions);
			const least = joined(paint.raw(first.color, glyphs.peers), mentions);
			return {
				text: full,
				shrink: (width) =>
					visibleWidth(full) <= width ? full : visibleWidth(short) <= width ? short : least,
			};
		},
	},
	tasks: {
		priority: 30,
		describe:
			"what the agent is doing, then ⚑ how many tasks wait on you or on something outside, ⧗ how many are queued and ✓ how many are done, from the tasks package",
		// The counts outlive the task's words: a short line cuts the words.
		render: ({ snapshot, glyphs, paint }) => {
			const state = snapshot.tasks;
			if (state === undefined) return undefined;
			const doing = tasksWith(state, "doing");
			const step = doing[0]?.text ?? state.title;
			const more = doing.length > 1 ? paint.dim(` +${doing.length - 1}`) : "";
			const counts = [
				tally(tasksWith(state, "waiting").length, glyphs.waiting, "waiting", paint),
				tally(tasksWith(state, "queued").length, glyphs.queued, "queued", paint),
				tally(tasksWith(state, "done").length, glyphs.done, "done", paint),
			].filter((part) => part !== "");
			if (step === undefined && counts.length === 0) return undefined;
			// Between tasks the line stays, so what was done and what waits do not vanish with them.
			const icon = mark(glyphs.tasks, paint, "tasks");
			const words = (room: number) =>
				step === undefined ? paint.dim("idle") : paint.text(fitWidth(step, room, glyphs.ellipsis));
			const tail = `${more}${counts.length === 0 ? "" : `  ${counts.join("  ")}`}`;
			const fixed = visibleWidth(icon) + visibleWidth(tail);
			return {
				text: `${icon}${words(Number.MAX_SAFE_INTEGER)}${tail}`,
				shrink: (width) => `${icon}${words(Math.max(1, width - fixed))}${tail}`,
			};
		},
	},
	session: {
		priority: 45,
		describe: "the session name, once it has one",
		render: ({ snapshot, glyphs, paint }) => {
			const name = snapshot.sessionName;
			if (name === undefined || name === "") return undefined;
			const icon = mark(glyphs.session, paint, "session");
			return {
				text: `${icon}${paint.role("session", fitWidth(name, 32, glyphs.ellipsis))}`,
				compact: `${icon}${paint.role("session", fitWidth(name, 14, glyphs.ellipsis))}`,
			};
		},
	},
	version: {
		priority: 10,
		describe: "the pi version, so a report says which one it was",
		render: ({ snapshot, glyphs, paint }) => ({
			text: `${mark(glyphs.version, paint, "brand")}${paint.role("version", snapshot.version)}`,
		}),
	},
	clock: {
		priority: 15,
		describe: "the time of day",
		render: ({ snapshot, glyphs, paint }) => {
			const now = new Date(snapshot.now);
			const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
			return { text: `${mark(glyphs.clock, paint, "clock")}${paint.role("clock", time)}` };
		},
	},
	provider: {
		priority: 40,
		describe: "who serves the model, on its own",
		render: ({ snapshot, paint }) =>
			snapshot.model === undefined
				? undefined
				: { text: paint.role("provider", snapshot.model.provider) },
	},
	model: {
		priority: 100,
		describe: "the model doing the work, after its provider and the account it runs on",
		render: ({ snapshot, glyphs, paint }) => {
			const icon = mark(glyphs.model, paint, "provider");
			if (snapshot.model === undefined) return { text: `${icon}${paint.dim("no model")}` };
			const name = paint.bold(paint.role("model", snapshot.model.name));
			const account =
				snapshot.account === undefined
					? ""
					: `${paint.dim("(")}${paint.role("provider", snapshot.account.label)}${paint.dim(")")}`;
			const provider = `${paint.role("provider", snapshot.model.provider)}${account}${paint.dim("/")}`;
			return {
				text: `${icon}${provider}${name}`,
				compact: account === "" ? `${icon}${name}` : `${icon}${name} ${account}`,
			};
		},
	},
	quota: {
		priority: 58,
		describe: "what each window of the plan spent, and when it resets",
		render: ({ snapshot, paint }) => {
			const account = snapshot.account;
			if (account === undefined) return undefined;
			if (account.needsLogin === true) return { text: paint.stress(100, "sign in again") };
			if (account.windows.length === 0) return undefined;
			const text = account.windows.map((window) => quotaWindow(paint, window)).join("  ");
			return { text };
		},
	},
	effort: {
		priority: 80,
		describe: "how hard the model thinks, as a meter that warms with the level",
		render: ({ snapshot, glyphs, paint }) => {
			if (snapshot.model?.reasoning !== true) return undefined;
			const level = snapshot.thinking ?? "off";
			const reached = EFFORT_LEVELS.indexOf(level as (typeof EFFORT_LEVELS)[number]);
			const meter = EFFORT_LEVELS.map((step, index) => {
				const bar = glyphs.levels[index] ?? "|";
				return index <= reached ? paint.effort(step, bar) : paint.dim(bar);
			}).join("");
			const label = level === "off" ? paint.dim(level) : paint.effort(level, level);
			return { text: `${meter} ${label}`, compact: meter };
		},
	},
	context: {
		priority: 88,
		describe: "how full the context window is, with the tokens in it over the window",
		render: ({ snapshot, glyphs, paint, options }) => {
			const context = snapshot.context;
			if (context === undefined) return undefined;
			const glyph =
				glyphs.context === "" ? "" : `${paint.stress(context.percent, glyphs.context)} `;
			const icon = `${glyph}${word(options, glyphs.context === "ctx" ? "" : "ctx", paint)}`;
			const value = paint.stress(context.percent, percent(context.percent));
			const cells = gauge(context.percent, options.gaugeCells);
			const bar =
				options.gaugeCells <= 0
					? ""
					: ` ${paint.stress(context.percent, glyphs.fill.repeat(cells.filled))}${paint.dim(glyphs.empty.repeat(cells.empty))}`;
			const size = paint.dim(` ${count(context.tokens)}/${count(context.window)}`);
			return { text: `${icon}${value}${bar}${size}`, compact: `${icon}${value}` };
		},
	},
	speed: {
		priority: 60,
		describe:
			"how fast tokens flow in this answer: out ↓ is the model writing, in ↑ is it reading the prompt",
		render: ({ snapshot, glyphs, paint, options }) => {
			const request = snapshot.request;
			if (request === undefined) return undefined;
			const out = speedCell(request.decode);
			const value = request.estimated ? paint.muted(out) : paint.bold(paint.role("speed", out));
			const down = `${flow("received", glyphs, paint, options)}${value}`;
			const up = `${flow("sent", glyphs, paint, options)}${paint.role("sent", speedCell(request.prefill))}`;
			const icon = mark(glyphs.speed, paint, "speed");
			const unit = paint.dim(" tok/s");
			return { text: `${icon}${down} ${up}${unit}`, compact: `${icon}${down}${unit}` };
		},
	},
	wait: {
		priority: 55,
		describe:
			"time to first token (ttft): from the request leaving to the model writing its first token",
		render: ({ snapshot, glyphs, paint, options }) => {
			const request = snapshot.request;
			if (request === undefined) return undefined;
			const ms = request.waiting ? request.waitingMs : request.waitMs;
			const icon = glyphs.wait === "" ? "" : `${paint.role("wait", glyphs.wait)} `;
			const value = cell(ms === undefined ? UNKNOWN : latency(ms), CELL.latency);
			return {
				text: `${icon}${word(options, "ttft", paint, glyphs.wait === "ttft")}${paint.role("wait", value)}`,
			};
		},
	},
	elapsed: {
		priority: 65,
		describe:
			"the run: while the agent works, how long and how many calls to the model; once it answered, the same and what it cost",
		render: ({ snapshot, glyphs, paint }) => {
			const run = snapshot.run;
			if (run === undefined) return undefined;
			const role: Role = run.running ? "running" : "done";
			const icon = mark(run.running ? glyphs.running : glyphs.done, paint, role);
			const time = paint.role(role, stopwatch(run.elapsedMs));
			const lead = run.running ? time : `${paint.dim("answered in ")}${time}`;
			const calls = run.requests <= 1 ? "" : paint.dim(`  ${run.requests} calls`);
			const cost =
				run.running || run.cost === 0 ? "" : `  ${paint.money(run.cost, money(run.cost))}`;
			return { text: `${icon}${lead}${calls}${cost}`, compact: `${icon}${time}` };
		},
	},
	last: {
		priority: 55,
		describe:
			"the last call that finished: how long the model took to start, how long it thought, and how fast it wrote",
		render: ({ snapshot, glyphs, paint, options }) => {
			const last = snapshot.last;
			if (last === undefined) return undefined;
			const parts: string[] = [];
			if (last.waitMs !== undefined) {
				const wait = paint.role("wait", latency(last.waitMs));
				parts.push(
					options.labels
						? `${wait}${paint.dim(" wait")}`
						: `${mark(glyphs.wait, paint, "wait")}${wait}`,
				);
			}
			if (last.thoughtMs !== undefined) {
				const thought = paint.role("wait", latency(last.thoughtMs));
				parts.push(
					options.labels ? `${thought}${paint.dim(" thought")}` : `${thought}${paint.dim(" th")}`,
				);
			}
			if (last.decode !== undefined) {
				const speed = `${paint.role("received", glyphs.received)}${paint.role("speed", rate(last.decode))}`;
				parts.push(`${speed}${paint.dim(" tok/s")}`);
			}
			if (parts.length === 0) return undefined;
			const label = options.labels ? paint.dim("last call ") : "";
			return { text: `${label}${parts.join("  ")}`, compact: parts[0] };
		},
	},
	server: {
		priority: 53,
		describe:
			"how long the provider took to answer the request, before the model wrote anything: send to headers",
		render: ({ snapshot, paint }) => {
			const ms = snapshot.last?.serverMs;
			if (ms === undefined) return undefined;
			return { text: `${paint.role("wait", latency(ms))}${paint.dim(" server")}` };
		},
	},
	request: {
		priority: 30,
		describe: "tokens of this answer: in ↑ is the prompt sent, out ↓ is what the model wrote",
		render: ({ snapshot, glyphs, paint, options }) => {
			const usage = snapshot.request?.usage;
			if (usage === undefined) return undefined;
			const sent = usage.input + usage.cacheRead + usage.cacheWrite;
			const up = `${flow("sent", glyphs, paint, options)}${tokenCell(sent)}`;
			const down = `${flow("received", glyphs, paint, options)}${tokenCell(usage.output)}`;
			const cache = cacheParts(usage, glyphs, paint, options, true);
			return {
				text: `${up} ${paint.dim("(")}${cache}${paint.dim(")")} ${down}`,
				compact: `${up} ${down}`,
			};
		},
	},
	costRate: {
		priority: 26,
		describe:
			"what a million tokens cost in this answer, the number that says whether a model is cheap",
		render: ({ snapshot, paint }) => {
			const usage = snapshot.request?.usage;
			if (usage === undefined) return undefined;
			const tokens = tokensOf(usage);
			if (usage.cost === 0 || tokens === 0) return undefined;
			const perMillion = (usage.cost / tokens) * 1_000_000;
			if (perMillion < 0.005) return undefined;
			return {
				text: `${paint.role("cost", `$${perMillion.toFixed(2)}`)}${paint.dim(" per Mtok")}`,
			};
		},
	},
	cost: {
		priority: 75,
		describe:
			"what the session cost; `sub` means a subscription, so it is what the tokens would have cost",
		render: ({ snapshot, glyphs, paint }) => {
			const amount = snapshot.totals.cost;
			// A session that spent nothing has nothing to say yet.
			if (amount === 0) return undefined;
			const value = paint.money(amount, money(amount));
			// On a plan nothing is billed per token: the amount is what the tokens would cost.
			const what = paint.dim(snapshot.subscription ? " at API prices" : " this session");
			const icon = glyphs.cost === "$" ? "" : mark(glyphs.cost, paint, "cost");
			return { text: `${icon}${value}${what}`, compact: `${icon}${value}` };
		},
	},
	tokens: {
		priority: 35,
		describe:
			"tokens of the whole session: ↑ sent to the model, cache included, and ↓ what it wrote back",
		render: ({ snapshot, glyphs, paint, options }) => {
			const totals = snapshot.totals;
			if (tokensOf(totals) === 0) return undefined;
			// Everything sent, not just the uncached part: `66 in` next to a million cached reads is a lie.
			const sent = paint.role("sent", count(promptOf(totals)));
			const got = paint.role("received", count(totals.output));
			const arrows = `${paint.role("sent", glyphs.sent)}${sent} ${paint.role("received", glyphs.received)}${got}`;
			if (!options.labels) return { text: arrows };
			return {
				text: `${paint.dim("in ")}${sent}  ${paint.dim("out ")}${got}`,
				compact: `${paint.dim("in ")}${sent} ${paint.dim("out ")}${got}`,
			};
		},
	},
	cache: {
		priority: 30,
		describe:
			"how much of the last prompt was read from the cache; `new` when it was only just written",
		render: ({ snapshot, glyphs, paint, options }) => {
			const hit = snapshot.cacheHit;
			if (hit === undefined) return undefined;
			const icon = mark(glyphs.cacheRead, paint, "cache");
			// A prompt that was written to the cache and not read from it is the cache warming up, not a miss.
			if (snapshot.cacheWarming)
				return { text: `${icon}${paint.muted(options.labels ? "cache new" : "new")}` };
			const value =
				hit >= 90 ? paint.role("done", percent(hit)) : paint.stress(100 - hit, percent(hit));
			return {
				// The numbers around it are the session's, so the label says this one is the last prompt's.
				text: options.labels
					? `${paint.dim("last prompt ")}${value}${paint.dim(" cached")}`
					: `${icon}${value}`,
				compact: options.labels ? `${paint.dim("cache ")}${value}` : `${icon}${value}`,
			};
		},
	},
	average: {
		priority: 25,
		describe:
			"the session's average speeds: ↓ the model writing, ↑ it reading the prompt, cache included",
		render: ({ snapshot, paint }) => {
			const { decode, prefill } = snapshot.averages;
			if (decode === undefined && prefill === undefined) return undefined;
			const down =
				decode === undefined ? "" : `${paint.dim("out ")}${paint.role("speed", rate(decode))}`;
			const up =
				prefill === undefined ? "" : `${paint.dim("in ")}${paint.role("sent", rate(prefill))}`;
			const label = paint.dim("avg ");
			const unit = paint.dim(" tok/s");
			return {
				text: `${label}${[down, up].filter((part) => part !== "").join(" ")}${unit}`,
				compact: down === "" ? undefined : `${label}${down}${unit}`,
			};
		},
	},
	statuses: {
		priority: 50,
		describe: "what other packages report through setStatus, minus the ones placed on their own",
		render: ({ snapshot, glyphs, paint, options }) => {
			const texts = [...snapshot.statuses]
				.filter(([key]) => !options.claimed.has(key))
				.map(([, text]) => text);
			if (texts.length === 0) return undefined;
			const icon = glyphs.plug === "" ? "" : `${paint.dim(glyphs.plug)} `;
			return {
				text: `${icon}${texts.join("  ")}`,
				compact: `${icon}${texts[0] ?? ""}`,
			};
		},
	},
};

export function renderSegments(ids: readonly SegmentId[], input: SegmentInput): Piece[] {
	return ids.flatMap((id): Piece[] => {
		if (id.startsWith(STATUS_PREFIX)) {
			const text = input.snapshot.statuses.get(id.slice(STATUS_PREFIX.length));
			return text === undefined ? [] : [{ text, priority: STATUS_PRIORITY }];
		}
		const segment = SEGMENTS[id as BuiltinSegment];
		const rendered = segment.render(input);
		return rendered === undefined ? [] : [{ ...rendered, priority: segment.priority }];
	});
}

/** One plan window, like `5h 62% resets in 2h`. The percent carries the color. */
function quotaWindow(paint: Paint, window: AccountWindow): string {
	const used = paint.stress(window.used, `${window.used}%`);
	const reset =
		window.resetsIn === undefined ? "" : ` ${paint.muted(`resets in ${window.resetsIn}`)}`;
	return `${paint.dim(window.name)} ${used}${reset}`;
}

/** The parts that have something to say, with the gap the footer uses between things. */
function joined(...parts: string[]): string {
	return parts.filter((part) => part !== "").join("  ");
}

function mark(glyph: string, paint: Paint, role: Role): string {
	return glyph === "" ? "" : `${paint.role(role, glyph)} `;
}

/** `✓2` in the color of what it counts, like the branch's marks. ASCII icons have no glyph, so the word goes. */
function tally(
	size: number,
	glyph: string,
	role: "done" | "queued" | "waiting",
	paint: Paint,
): string {
	if (size === 0) return "";
	return paint.role(role, glyph === "" ? `${size} ${role}` : `${glyph} ${size}`);
}

function counted(value: number, glyph: string, role: Role, paint: Paint): string {
	return value > 0 ? paint.role(role, `${glyph}${value}`) : "";
}

function cacheParts(
	usage: Totals,
	glyphs: Glyphs,
	paint: Paint,
	options: SegmentOptions,
	fixed = false,
): string {
	const value = (tokens: number) => (fixed ? tokenCell(tokens) : tokens > 0 ? count(tokens) : "");
	const read = value(usage.cacheRead);
	const write = value(usage.cacheWrite);
	if (options.labels) {
		const parts = [
			read === "" ? "" : `${paint.dim("read ")}${paint.role("cache", read)}`,
			write === "" ? "" : `${paint.dim("wrote ")}${paint.role("cache", write)}`,
		].filter((part) => part !== "");
		return parts.length === 0 ? "" : `${paint.dim("cache ")}${parts.join("  ")}`;
	}
	return [
		read === "" ? "" : `${paint.role("cache", glyphs.cacheRead)}${read}`,
		write === "" ? "" : `${paint.role("cache", glyphs.cacheWrite)}${write}`,
	]
		.filter((part) => part !== "")
		.join(" ");
}

function flow(
	role: "sent" | "received",
	glyphs: Glyphs,
	paint: Paint,
	options: SegmentOptions,
): string {
	const arrow = role === "sent" ? glyphs.sent : glyphs.received;
	const name = role === "sent" ? "in" : "out";
	return paint.role(role, options.labels ? `${arrow}${name} ` : arrow);
}

function word(options: SegmentOptions, text: string, paint: Paint, skip = false): string {
	return options.labels && !skip && text !== "" ? paint.dim(`${text} `) : "";
}

function speedCell(value: number | undefined): string {
	return cell(value === undefined ? UNKNOWN : rate(value), CELL.rate);
}

function tokenCell(value: number): string {
	return cell(value === 0 ? UNKNOWN : count(value), CELL.count);
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}
