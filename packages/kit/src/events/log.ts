// What every feature does goes into one log per session, so another session, a bridge or a web UI
// can follow it live and replay it later. Only the session itself writes its file, and all the
// harness's extensions share one thread, so lines never interleave and nothing needs a lock.
import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	readSync,
	openSync,
	closeSync,
	fstatSync,
	watch,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { LogEventMap } from "../contracts/events.ts";
import { isObject } from "../decode.ts";

export const EVENTS_VERSION = 1;
/** Every event is also published here, inside the process. */
export const LOGGED_EVENT = "harness:logged";

export type EventType = keyof LogEventMap;

export interface LoggedEvent<K extends EventType = EventType> {
	v: typeof EVENTS_VERSION;
	id: string;
	/** Milliseconds since the epoch. */
	at: number;
	session: string;
	type: K;
	data: LogEventMap[K];
	/** The pi session entry it came from, so a viewer can open that point of the conversation. */
	entry?: string;
}

/** Where a session writes: its folder's directory and its own file in it. */
export interface LogTarget {
	dir: string;
	session: string;
}

interface Bus {
	emit(channel: string, data: unknown): void;
}

interface SessionSource {
	getCwd(): string;
	getSessionId(): string;
}

/** `PI_HARNESS_EVENTS` moves every log, so tests and tools can point it elsewhere. */
export function eventsRoot(): string {
	return process.env.PI_HARNESS_EVENTS ?? join(getAgentDir(), "harness", "events");
}

/** The directory of a folder's logs, named the way pi names its session folders. */
export function eventsDir(cwd: string, root = eventsRoot()): string {
	return join(root, `--${cwd.replace(/^[/\\]+/, "").replace(/[/\\:]+/g, "-")}--`);
}

/**
 * Where shared rooms live, one directory each. A folder's directory always starts with `--`, so this
 * never takes a folder's name.
 */
export function roomsDir(root = eventsRoot()): string {
	return join(root, "rooms");
}

/** The directory of a shared room's logs. */
export function roomDir(id: string, root = eventsRoot()): string {
	return join(roomsDir(root), id);
}

/** The index of the sessions open now, one small file each, so finding them reads no logs. */
export function liveDir(root = eventsRoot()): string {
	return join(root, "live");
}

export function targetOf(session: SessionSource, root?: string): LogTarget {
	return { dir: eventsDir(session.getCwd(), root), session: session.getSessionId() };
}

export function logPath(target: LogTarget): string {
	return join(target.dir, `${target.session}.jsonl`);
}

let counter = 0;

/** Appends the event to the session's log and publishes it inside the process. */
export function logEvent<K extends EventType>(
	target: LogTarget,
	bus: Bus | undefined,
	type: K,
	data: LogEventMap[K],
	entry?: string,
	at = Date.now(),
): LoggedEvent<K> {
	counter = (counter + 1) % 1_296;
	const event: LoggedEvent<K> = {
		v: EVENTS_VERSION,
		id: `${at.toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`,
		at,
		session: target.session,
		type,
		data,
		...(entry === undefined ? {} : { entry }),
	};
	try {
		mkdirSync(target.dir, { recursive: true });
		appendFileSync(logPath(target), `${JSON.stringify(event)}\n`);
	} catch {
		// A log that cannot be written must never stop the session.
	}
	bus?.emit(LOGGED_EVENT, event);
	return event;
}

/** Logs from a handler's context. A context with no session behind it logs nothing. */
export function logFrom<K extends EventType>(
	ctx: { sessionManager: Partial<SessionSource> },
	bus: Bus | undefined,
	type: K,
	data: LogEventMap[K],
	entry?: string,
): LoggedEvent<K> | undefined {
	const { getCwd, getSessionId } = ctx.sessionManager;
	if (getCwd === undefined || getSessionId === undefined) return undefined;
	return logEvent(targetOf(ctx.sessionManager as SessionSource), bus, type, data, entry);
}

export const HOST = hostname();

/** Reads the whole events written after `offset`. A line still being written waits for the next read. */
export function readFrom(path: string, offset: number): { events: LoggedEvent[]; offset: number } {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return { events: [], offset };
	}
	try {
		const size = fstatSync(fd).size;
		if (size <= offset) return { events: [], offset: size < offset ? 0 : offset };
		const buffer = Buffer.alloc(size - offset);
		readSync(fd, buffer, 0, buffer.length, offset);
		const text = buffer.toString("utf8");
		const end = text.lastIndexOf("\n");
		if (end === -1) return { events: [], offset };
		const events = text
			.slice(0, end)
			.split("\n")
			.flatMap((line) => parsed(line));
		return { events, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
	} finally {
		closeSync(fd);
	}
}

function parsed(line: string): LoggedEvent[] {
	try {
		const value: unknown = JSON.parse(line);
		const ok =
			isObject(value) &&
			value.v === EVENTS_VERSION &&
			typeof value.type === "string" &&
			typeof value.session === "string" &&
			typeof value.at === "number";
		return ok ? [value as unknown as LoggedEvent] : [];
	} catch {
		return [];
	}
}

/** Every session's log in a folder, read from where it was left: new events, oldest first. */
export class FolderFeed {
	readonly #dir: string;
	readonly #offsets = new Map<string, number>();

	constructor(dir: string) {
		this.#dir = dir;
	}

	get dir(): string {
		return this.#dir;
	}

	read(): LoggedEvent[] {
		let files: string[];
		try {
			files = readdirSync(this.#dir).filter((name) => name.endsWith(".jsonl"));
		} catch {
			return [];
		}
		const fresh: LoggedEvent[] = [];
		for (const name of files) {
			const path = join(this.#dir, name);
			const { events, offset } = readFrom(path, this.#offsets.get(path) ?? 0);
			this.#offsets.set(path, offset);
			fresh.push(...events);
		}
		return fresh.toSorted((a, b) => a.at - b.at || a.id.localeCompare(b.id));
	}

	/** Calls back when a log in the folder changes, or every second where watching is not there. */
	watch(changed: () => void): () => void {
		mkdirSync(this.#dir, { recursive: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		const soon = () => {
			if (timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				changed();
			}, 30);
		};
		try {
			const watcher = watch(this.#dir, soon);
			watcher.on("error", () => {});
			return () => {
				watcher.close();
				if (timer !== undefined) clearTimeout(timer);
			};
		} catch {
			const poll = setInterval(changed, 1_000);
			return () => clearInterval(poll);
		}
	}
}
