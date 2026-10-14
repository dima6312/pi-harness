// The start screen says what changed since the last session in a folder, so it remembers when that
// was and which harness version ran it. One small file for every folder.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LastVisit } from "./start-notes.ts";

type Visits = Record<string, LastVisit>;

/** The last visit to `cwd`, and records this one. */
export function visit(
	file: string,
	cwd: string,
	version: string,
	now: number,
): LastVisit | undefined {
	const visits = read(file);
	const last = visits[cwd];
	visits[cwd] = { at: now, version };
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(visits));
	} catch {
		// A start screen that cannot remember only loses "since when".
	}
	return last;
}

function read(file: string): Visits {
	try {
		const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return typeof value === "object" && value !== null ? (value as Visits) : {};
	} catch {
		return {};
	}
}
