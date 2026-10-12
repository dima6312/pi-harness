// A recorded session's branch, as the eval scripts read it.
import { readFileSync } from "node:fs";

export interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	message?: { role?: string; stopReason?: string };
}

/** The branch that ends at the file's last entry, oldest first. */
export function readBranch(file: string): Entry[] {
	const entries = readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Entry);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const path: Entry[] = [];
	for (let at = entries.at(-1); at; at = at.parentId ? byId.get(at.parentId) : undefined)
		path.unshift(at);
	return path;
}
