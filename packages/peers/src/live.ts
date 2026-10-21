// The sessions open on this machine, one small file each, so the panel and an agent asking for a
// room find who is open in a folder without reading every folder's logs. It is an index, not a
// record: the logs stay the record, and nothing replays this.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isObject, liveDir } from "@adeildo/pi-kit";

import type { LiveSession } from "./model.ts";

function pathOf(session: string, root?: string): string {
	return join(liveDir(root), `${session}.json`);
}

/** Writes this session's entry. Failing to must never stop the session. */
export function writeLive(entry: LiveSession, root?: string): void {
	try {
		mkdirSync(liveDir(root), { recursive: true });
		writeFileSync(pathOf(entry.session, root), JSON.stringify(entry));
	} catch {
		// Without the index, this session is only harder to find.
	}
}

export function removeLive(session: string, root?: string): void {
	rmSync(pathOf(session, root), { force: true });
}

/**
 * The sessions open now, oldest first. A session that crashed leaves its file behind, so one on this
 * host whose process is gone is left out.
 */
export function readLive(
	alive: (pid: number) => boolean,
	host: string,
	root?: string,
): LiveSession[] {
	let names: string[];
	try {
		names = readdirSync(liveDir(root)).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	return names
		.flatMap((name) => {
			const entry = parsed(join(liveDir(root), name));
			if (entry === undefined) return [];
			return entry.host === host && !alive(entry.pid) ? [] : [entry];
		})
		.toSorted((a, b) => a.startedAt - b.startedAt || a.session.localeCompare(b.session));
}

function parsed(path: string): LiveSession | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		const ok =
			isObject(value) &&
			typeof value.session === "string" &&
			typeof value.pid === "number" &&
			typeof value.host === "string" &&
			typeof value.cwd === "string" &&
			typeof value.startedAt === "number";
		return ok ? (value as unknown as LiveSession) : undefined;
	} catch {
		return undefined;
	}
}
