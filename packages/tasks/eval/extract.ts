// Prints a session the way the tasks' model reads it, so a case can be cut from it.
// bun packages/tasks/eval/extract.ts <session.jsonl>              your messages, with their entry ids
// bun packages/tasks/eval/extract.ts <session.jsonl> <from> [to]  the run after entry <from>, up to <to>
import { heard, runSince, yourWords } from "../src/transcript.ts";
import { readBranch } from "./session.ts";

const [file, from, to] = process.argv.slice(2);
if (file === undefined) throw new Error("usage: extract.ts <session.jsonl> [from] [to]");

const branch = readBranch(file);

if (from === undefined) {
	for (const entry of branch) {
		const text = entry.type === "message" ? yourWords(entry.message) : undefined;
		if (text === undefined) continue;
		const { reply } = heard(branch.slice(0, branch.indexOf(entry) + 1), text);
		console.log(`\n${entry.id}  ${text.slice(0, 300)}`);
		if (reply !== undefined) console.log(`  agent before: ${reply.slice(0, 200)}`);
	}
} else {
	const end = to === undefined ? branch.length : branch.findIndex((entry) => entry.id === to) + 1;
	console.log(runSince(branch.slice(0, end), from).text);
}
