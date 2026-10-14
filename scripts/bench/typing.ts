#!/usr/bin/env bun
// The typing bench: opens pi in a terminal of its own, on a copy of the longest session in this
// folder, types a line one character at a time and measures how long each keystroke takes to reach
// the screen. `--cpu-prof` writes a profile beside the copy, so the same run also says where those
// milliseconds went, which is what makes the number actionable.
//
// Usage:
//   bun scripts/bench/typing.ts [--text "..."] [--warmup <seconds>] [--session <file>] [--max-mb 20] [--keep]
//   bun scripts/bench/typing.ts --profile <file> [--from 12] [--to 16] [--under "<frame>"]
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { benchEnv } from "./env.ts";
import { type Cost, ours, readProfile, report, under } from "./profile.ts";

/** Long enough to see the cost, short enough to read the numbers: the line the first bench typed. */
const DEFAULT_TEXT = "testando a velocidade de digitacao do pi agora mesmo";
/** Waiting for pi to stop drawing: a long transcript takes as long as it takes. */
const MIN_WARMUP_MS = 4000;
const MAX_WARMUP_MS = 120_000;
const QUIET_MS = 1200;
const ROWS = 50;
const COLS = 160;
/** Room for a keystroke whose redraw never comes back. */
const KEY_TIMEOUT_MS = 2000;
/** Between keystrokes, so typing is not one long burst. */
const KEY_GAP_MS = 30;
/** A transcript past this size takes minutes to open, which says nothing about typing. */
const MAX_SESSION_MB = 20;

const root = resolve(import.meta.dir, "../..");
const profileFile = flag("profile");
const startFlag = flag("from");
const endFlag = flag("to");
const drill = flag("under");

if (profileFile !== undefined) {
	analyze(
		profileFile,
		startFlag === undefined ? 0 : Number(startFlag),
		endFlag === undefined ? Number.POSITIVE_INFINITY : Number(endFlag),
		drill,
	);
	process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "pi-typing-"));
const cap = Number(flag("max-mb") ?? MAX_SESSION_MB) * 1024 * 1024;
const original = flag("session") ?? longestSession(root, cap);
const session = original === undefined ? undefined : join(dir, "session.jsonl");
if (original !== undefined && session !== undefined) copyFileSync(original, session);
const text = flag("text") ?? DEFAULT_TEXT;
const warmup = flag("warmup");

let output = 0;
let lastOutput = performance.now();
const spawnedAt = performance.now();
const child = Bun.spawn(["pi", ...(session === undefined ? [] : ["--session", session])], {
	cwd: root,
	env: benchEnv(process.env, dir),
	terminal: {
		cols: COLS,
		rows: ROWS,
		data: () => {
			output++;
			lastOutput = performance.now();
		},
	},
});
const send = (data: string): void => {
	try {
		child.terminal?.write(data);
	} catch {
		// The process is gone; the numbers already collected are still worth printing.
	}
};

console.log(`pi opened${original === undefined ? " a new session" : ` ${original}`}`);
if (original === undefined)
	console.log(
		"no session of this folder was found, so these are the numbers of an empty transcript",
	);
console.log(`warming up for ${warmup === undefined ? "as long as it draws" : `${warmup}s`}`);
await ready(warmup);
console.log(`typing ${text.length} characters`);

const typedFrom = performance.now();
const latencies: number[] = [];
for (const character of text) {
	const before = output;
	const at = performance.now();
	send(character);
	// oxlint-disable-next-line no-await-in-loop -- one keystroke and its redraw are the measurement
	await waitFor(() => output > before, KEY_TIMEOUT_MS);
	latencies.push(performance.now() - at);
	// oxlint-disable-next-line no-await-in-loop -- the gap keeps the keystrokes apart
	await Bun.sleep(KEY_GAP_MS);
}
const typedTo = performance.now();

// Clear the editor, leave pi the way a person would, and let the profiler write its files.
send("\u0015");
await Bun.sleep(300);
send("\u0003");
await Bun.sleep(400);
send("\u0003");
await Bun.sleep(400);
send("\u0004");
await Promise.race([child.exited, Bun.sleep(3000)]);
child.kill();
await Bun.sleep(300);

console.log(typedLine(latencies, text.length));
const start = startFlag === undefined ? (typedFrom - spawnedAt) / 1000 : Number(startFlag);
const end = endFlag === undefined ? (typedTo - spawnedAt) / 1000 : Number(endFlag);
const files = readdirSync(dir)
	.filter((name) => name.endsWith(".cpuprofile"))
	.map((name) => join(dir, name));
// Pi spawns helpers of its own, and they write profiles too: the one that covers the window is the
// process that was drawing.
let main: { file: string; ms: number } | undefined;
for (const file of files) {
	const ms = busyOf(file, start, end);
	if (main === undefined || ms > main.ms) main = { file, ms };
}
if (main === undefined) {
	console.log("\nno profile was written: the profiler writes only when the process exits");
} else {
	console.log(
		`\n${files.length} profiles written; the busiest was busy for ${main.ms.toFixed(0)} ms`,
	);
	analyze(main.file, start, end, drill);
}
if (process.argv.includes("--keep")) console.log(`\nkept ${dir}`);
else rmSync(dir, { recursive: true, force: true });

/** The busy time this profile has in the window: pi's helpers write profiles too, and idle ones. */
function busyOf(file: string, from: number, to: number): number {
	return report(readProfile(readFileSync(file, "utf8")), from, to).busyMs;
}

/** How long a sample's window was: the seconds since pi started, as the profile counts them. */
function analyze(file: string, from: number, to: number, target: string | undefined): void {
	const profile = readProfile(readFileSync(file, "utf8"));
	const result = report(profile, from, to);
	console.log(
		`\nwindow ${from.toFixed(1)}-${to.toFixed(1)}s: busy ${result.busyMs.toFixed(0)} ms of ${result.totalMs.toFixed(0)} ms`,
	);
	console.log("\nwhere the time went:");
	for (const cost of result.inclusive.slice(0, 15)) console.log(costLine(cost));
	const mine = ours(result.inclusive);
	if (mine.length > 0) {
		console.log("\nthis repository:");
		for (const cost of mine.slice(0, 15)) console.log(costLine(cost));
	}
	if (target !== undefined) {
		console.log(`\nunder ${target}:`);
		for (const cost of under(profile, from, to, target).slice(0, 15)) console.log(costLine(cost));
	}
}

function typedLine(values: readonly number[], chars: number): string {
	const sorted = [...values].toSorted((a, b) => a - b);
	if (sorted.length === 0) return `typed ${chars} characters, no key came back`;
	const total = sorted.reduce((sum, value) => sum + value, 0);
	const average = total / sorted.length;
	const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;
	const worst = sorted.at(-1) ?? 0;
	const stalled = sorted.filter((value) => value >= KEY_TIMEOUT_MS - 10).length;
	const note = stalled === 0 ? "" : `, ${stalled} of them never came back`;
	return `\ntyped ${chars} characters: avg ${average.toFixed(1)} ms, p50 ${middle.toFixed(1)} ms, max ${worst.toFixed(1)} ms${note}`;
}

function costLine(cost: Cost): string {
	return `${cost.ms.toFixed(0).padStart(7)} ms  ${cost.frame}`;
}

/** The longest session of this folder that is still quick to open; the bench copies it, never opens it. */
function longestSession(cwd: string, limit: number): string | undefined {
	// Pi names a folder's session directory after its path, without the leading slash and with the
	// separators turned into dashes: /home/ada/repo becomes --home-ada-repo--.
	const slug = cwd.replace(/^\/+/, "").replaceAll("/", "-");
	const folder = join(homedir(), ".pi", "agent", "sessions", `--${slug}--`);
	let best: { file: string; size: number } | undefined;
	let largest: { file: string; size: number } | undefined;
	try {
		for (const name of readdirSync(folder)) {
			if (!name.endsWith(".jsonl")) continue;
			const file = join(folder, name);
			const size = statSync(file).size;
			if (largest === undefined || size > largest.size) largest = { file, size };
			if (size <= limit && (best === undefined || size > best.size)) best = { file, size };
		}
	} catch {
		return undefined;
	}
	return best?.file ?? largest?.file;
}

async function waitFor(arrived: () => boolean, timeoutMs: number): Promise<void> {
	const until = performance.now() + timeoutMs;
	// oxlint-disable-next-line no-await-in-loop -- polling this is cheaper than a timer per keystroke
	while (!arrived() && performance.now() < until) await Bun.sleep(5);
}

/** A long transcript takes its time to open; wait until pi has been quiet for a moment. */
async function ready(given: string | undefined): Promise<void> {
	if (given !== undefined) {
		await Bun.sleep(Number(given) * 1000);
		return;
	}
	const started = performance.now();
	// oxlint-disable-next-line no-await-in-loop -- one wait, checked as the screen goes quiet
	while (performance.now() - started < MAX_WARMUP_MS) {
		if (performance.now() - started >= MIN_WARMUP_MS && performance.now() - lastOutput >= QUIET_MS)
			return;
		// oxlint-disable-next-line no-await-in-loop -- sampling the quiet, not waiting on a promise
		await Bun.sleep(50);
	}
}

function flag(name: string): string | undefined {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? undefined : process.argv[at + 1];
}
