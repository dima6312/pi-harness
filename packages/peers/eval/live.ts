// A live test with a real pi: one session runs with only the peers tool, a script plays the colleague
// in the same folder, and the two exchange a message with no prompt from anyone.
// bun packages/peers/eval/live.ts [--model anthropic/claude-haiku-4-5]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { eventsDir, type LoggedEvent } from "@adeildo/pi-kit";

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
		records.push(JSON.parse(line) as Record<string, unknown>);
	}
});
pi.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

function command(record: Record<string, unknown>): void {
	pi.stdin.write(`${JSON.stringify(record)}\n`);
}

async function until<T>(what: string, ready: () => T | undefined, limit = 90_000): Promise<T> {
	const started = Date.now();
	while (Date.now() - started < limit) {
		const found = ready();
		if (found !== undefined) return found;
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

	const wake = await until(
		"the colleague's reply",
		() =>
			read(CANARY).find((event) => event.type === "message.posted" && event.data.id !== "ping-1"),
		120_000,
	);
	const reply = (wake.data as { from: string; text: string }).text;
	assert("a peer message woke it and it answered with the tool", reply.trim().length > 0);
	console.log(`     it answered: ${reply.trim().slice(0, 120)}`);

	const received = read(CANARY).find((event) => event.type === "message.received");
	assert("the colleague saw how the message arrived", received !== undefined);

	command({
		id: "ask",
		type: "prompt",
		message: "In one line, repeat the exact text of the message you got from the other agent.",
	});
	const said = await until(
		"the agent to say what it read",
		() =>
			(
				records.find(
					(record) =>
						record.type === "message_end" &&
						(record.message as { role?: string } | undefined)?.role === "assistant",
				)?.message as { content?: { type: string; text?: string }[] } | undefined
			)?.content
				?.find((part) => part.type === "text")
				?.text?.toLowerCase(),
		120_000,
	);
	assert("the words are in its context", said?.includes("ping from canary") === true);
} catch (error) {
	assert(`finished: ${error instanceof Error ? error.message : String(error)}`, false);
	for (const [name, session] of sessions().map((id) => [id, id] as const))
		console.log(
			`  ${name}: ${read(session)
				.map((event) => event.type)
				.join(", ")}`,
		);
	for (const record of records.filter((one) => one.type === "message_end"))
		console.log(`  said: ${JSON.stringify(record.message).slice(0, 400)}`);
	for (const record of records.filter(
		(one) => one.type === "tool_execution_end" || one.type === "error",
	))
		console.log(`  ${String(record.type)}: ${JSON.stringify(record).slice(0, 300)}`);
} finally {
	pi.kill();
	rmSync(folder, { recursive: true, force: true });
	rmSync(events, { recursive: true, force: true });
	delete process.env.PI_HARNESS_EVENTS;
	const failed = checks.filter(([, ok]) => !ok).length;
	console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
	process.exit(failed === 0 ? 0 : 1);
}
