// A live test with a real pi: one session runs with only the peers tool, a script plays the colleague
// in the same folder, and the two exchange a message with no prompt from anyone.
// bun packages/peers/eval/live.ts [--model anthropic/claude-haiku-4-5]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { eventsDir, FolderFeed, type LoggedEvent } from "@adeildo/pi-kit";

import { Folder } from "../src/folder.ts";

const { values } = parseArgs({
	options: { model: { type: "string", default: "anthropic/claude-haiku-4-5" } },
});

const folder = mkdtempSync(join(tmpdir(), "peers-folder-"));
const events = mkdtempSync(join(tmpdir(), "peers-live-"));
process.env.PI_HARNESS_EVENTS = events;
const CANARY = "canary-session";
const dir = eventsDir(folder, events);

/** The colleague writes its own log, the way another pi in the folder would. */
function log(session: string, type: string, data: unknown, at = Date.now()): void {
	writeFileSync(
		join(dir, `${session}.jsonl`),
		`${JSON.stringify({ v: 1, id: `${session}-${at}`, at, session, type, data })}\n`,
		{ flag: "a" },
	);
}

/** The folder as a colleague would read it: every session's log, merged. */
function folderOf(): Folder {
	const found = new Folder();
	found.apply(new FolderFeed(dir).read());
	return found;
}

function read(session: string): LoggedEvent[] {
	try {
		return readFileSync(join(dir, `${session}.jsonl`), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LoggedEvent);
	} catch {
		return [];
	}
}

function sessions(): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => name.replace(/\.jsonl$/, ""));
	} catch {
		return [];
	}
}

const pi = spawn(
	"pi",
	[
		"--mode",
		"rpc",
		"--no-session",
		"--model",
		values.model,
		"-t",
		"peers",
		"-e",
		resolve(import.meta.dir, "../src/index.ts"),
	],
	{
		cwd: folder,
		env: { ...process.env, PI_HARNESS_EVENTS: events },
		stdio: ["pipe", "pipe", "pipe"],
	},
);

const records: Record<string, unknown>[] = [];
let buffered = "";
pi.stdout.on("data", (chunk: Buffer) => {
	buffered += chunk.toString();
	const lines = buffered.split("\n");
	buffered = lines.pop() ?? "";
	for (const line of lines) {
		if (line.trim() === "") continue;
		const record = JSON.parse(line) as Record<string, unknown>;
		records.push(record);
		// The operator's permission judge asks before the tool runs. Answer the way they would.
		if (record.type === "extension_ui_request" && record.method === "select") {
			const options = (record.options ?? []) as string[];
			const yes = options.find((option) => option.includes("always yes")) ?? options[0];
			command({ type: "extension_ui_response", id: record.id, value: yes });
		}
	}
});
pi.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

function command(record: Record<string, unknown>): void {
	pi.stdin.write(`${JSON.stringify(record)}\n`);
}

async function until<T>(what: string, ready: () => T | undefined, limit = 240_000): Promise<T> {
	const started = Date.now();
	let last = 0;
	while (Date.now() - started < limit) {
		const found = ready();
		if (found !== undefined) {
			console.log(`     ${what}: ${Math.round((Date.now() - started) / 1000)}s`);
			return found;
		}
		// A line every 30s, so a slow judge or a long turn does not look like a hang.
		if (Date.now() - started - last > 30_000) {
			last = Date.now() - started;
			console.log(`     still waiting for ${what} (${Math.round(last / 1000)}s)`);
		}
		// oxlint-disable-next-line no-await-in-loop -- polling a file the other process writes
		await new Promise((later) => setTimeout(later, 250));
	}
	throw new Error(`timed out waiting for ${what}`);
}

const checks: [string, boolean][] = [];
function assert(what: string, ok: boolean): void {
	checks.push([what, ok]);
	console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
}

try {
	const session = await until("the session to start", () =>
		sessions().find((name) => name !== CANARY),
	);
	console.log(`session ${session} in ${folder}`);

	// The colleague shows up and asks something, exactly as another pi would.
	log(CANARY, "session.started", { pid: process.pid, host: "test", model: "played by the test" });
	log(CANARY, "session.named", { handle: "canary", title: "Canary" });
	log(CANARY, "message.posted", {
		id: "ping-1",
		from: "agent",
		to: [session],
		text: "ping from canary: answer me with the peers tool, any word.",
	});

	await until("the message to reach the agent", () =>
		read(session).find((event) => event.type === "message.received"),
	);
	assert("the message reached the agent", true);

	const wake = await until("the reply", () =>
		// The author writes the message in its own log, so the reply is in the session's.
		read(session).find(
			(event) =>
				event.type === "message.posted" && (event.data as { from?: string }).from === "agent",
		),
	);
	const reply = (wake.data as { text: string }).text;
	assert("a peer message woke it and it answered with the tool", reply.trim().length > 0);
	console.log(`     it answered: ${reply.trim().slice(0, 120)}`);

	// A colleague reads the folder's logs, the way another pi would.
	const seen = [...folderOf().messages.values()].find((one) => one.text === reply);
	assert("the reply is in the room, for everyone", seen !== undefined);
	assert("the reply is addressed to the colleague", seen?.to.includes(CANARY) === true);

	// The runtime records how the message arrived, and that the model read it, so no model turn
	// is needed to prove the words reached its context.
	const written = read(session);
	assert(
		"the delivery mode is on the record",
		written.some((event) => event.type === "message.received"),
	);
	assert(
		"the model read it",
		written.some((event) => event.type === "message.read"),
	);
} catch (error) {
	assert(`finished: ${error instanceof Error ? error.message : String(error)}`, false);
	for (const [name, session] of sessions().map((id) => [id, id] as const))
		console.log(
			`  ${name}: ${read(session)
				.map((event) => event.type)
				.join(", ")}`,
		);
	console.log(`  records: ${[...new Set(records.map((one) => String(one.type)))].join(", ")}`);
	for (const record of records.filter((one) => one.type !== "message_update"))
		console.log(`  ${String(record.type)}: ${JSON.stringify(record).slice(0, 600)}`);
} finally {
	pi.kill();
	rmSync(folder, { recursive: true, force: true });
	rmSync(events, { recursive: true, force: true });
	delete process.env.PI_HARNESS_EVENTS;
	const failed = checks.filter(([, ok]) => !ok).length;
	console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
	process.exit(failed === 0 ? 0 : 1);
}
