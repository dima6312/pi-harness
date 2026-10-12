// Prints a session the way the tasks' model reads it, so a case can be cut from it.
// bun packages/tasks/eval/extract.ts <session.jsonl>              your messages, with their entry ids
// bun packages/tasks/eval/extract.ts <session.jsonl> <from> [to]  the run after entry <from>, up to <to>
import { readFileSync } from "node:fs";

import { heard, operatorText, runSince } from "../src/transcript.ts";

interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	message?: unknown;
}

const [file, from, to] = process.argv.slice(2);
if (file === undefined) throw new Error("usage: extract.ts <session.jsonl> [from] [to]");

const entries = readFileSync(file, "utf8")
	.split("\n")
	.filter(Boolean)
	.map((line) => JSON.parse(line) as Entry);
const branch = pathTo(entries.at(-1), new Map(entries.map((entry) => [entry.id, entry])));

if (from === undefined) {
	for (const entry of branch) {
		const text = entry.type === "message" ? operatorText(entry.message) : undefined;
		if (text === undefined) continue;
		const { reply } = heard(branch.slice(0, branch.indexOf(entry) + 1), text);
		console.log(`\n${entry.id}  ${text.slice(0, 300)}`);
		if (reply !== undefined) console.log(`  agent before: ${reply.slice(0, 200)}`);
	}
} else {
	const end = to === undefined ? branch.length : branch.findIndex((entry) => entry.id === to) + 1;
	console.log(runSince(branch.slice(0, end), from).text);
}

/** The branch that ends at `entry`, oldest first. */
function pathTo(entry: Entry | undefined, byId: Map<string, Entry>): Entry[] {
	const path: Entry[] = [];
	for (let at = entry; at; at = at.parentId ? byId.get(at.parentId) : undefined) path.unshift(at);
	return path;
}
