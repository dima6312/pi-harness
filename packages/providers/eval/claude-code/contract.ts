// Reverse engineers the Claude Code release we mimic: the version, the features it knows, the betas
// a turn asks for, and the shape of the request it sends.
//
// The turn comes from the interactive TUI, not from `claude -p`: the two differ in entrypoint, user
// agent and identity block. A pty makes the TUI believe it is on a terminal, and the config directory
// is its own, so nothing reaches Anthropic and no account is involved.
//
// bun packages/providers/eval/claude-code/contract.ts [--version 2.1.299] [--channel latest]
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const BASE = "https://downloads.claude.ai/claude-code-releases";
const PROMPT = "Reply with the single word: pong";
const READY = 3_000;
const QUIET = 1_500;
const TURN = 120_000;
const POLL = 250;
const KEY = "sk-ant-api03-eval";

export type Channel = "stable" | "latest";

export interface Feature {
	name: string;
	/** What `anthropic-beta` carries to ask for it. */
	header: string;
	/** Whether a turn of the TUI asks for it. */
	turn: boolean;
}

export interface Contract {
	version: string;
	userAgent: string;
	/** What `cc_entrypoint` of the billing header carries. */
	entrypoint: string;
	identity: string;
	/** The blocks a turn puts in `system`, by length, and where the cache breakpoints are. */
	system: { length: number; cacheControl: boolean }[];
	/** The body fields a turn sends besides `system` and `messages`. */
	fields: string[];
	features: Feature[];
}

/** The version a channel points at, as plain text. */
export async function channelVersion(channel: Channel): Promise<string> {
	const version = (await text(`${BASE}/${channel}`)).trim();
	if (!/^[0-9]+(\.[0-9]+)+$/.test(version))
		throw new Error(`${channel} answered ${JSON.stringify(version)}, which is not a version`);
	return version;
}

export async function capture(version: string, workdir: string): Promise<Contract> {
	const binary = await download(version, workdir);
	const turn = await probeTurn(binary, PROMPT);
	const features = await registry(binary);

	const system = blocks(turn.body.system);
	const betas = new Set(betasOf(turn.headers, "anthropic-beta"));
	for (const feature of features) feature.turn = betas.has(feature.header);

	return {
		version,
		userAgent: header(turn.headers, "user-agent"),
		entrypoint: (billing(system)?.match(/cc_entrypoint=([^;]+)/) ?? [])[1] ?? "",
		identity: system[1]?.text ?? "",
		system: system.map((block) => ({
			length: block.text.length,
			cacheControl: block.cache_control !== undefined,
		})),
		fields: Object.keys(turn.body)
			.filter((field) => field !== "system" && field !== "messages")
			.toSorted(),
		features,
	};
}

/** The platform directory Anthropic uses for this host. */
function platform(): string {
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	if (process.platform === "darwin") return `darwin-${arch}`;
	if (process.platform === "linux") return `linux-${arch}`;
	throw new Error(`${process.platform} is not a platform Claude Code ships for`);
}

interface Manifest {
	platforms: Record<string, { binary: string; checksum: string }>;
}

/** Downloads the version into `workdir` and returns the binary's path. */
async function download(version: string, workdir: string): Promise<string> {
	const manifest = JSON.parse(await text(`${BASE}/${version}/manifest.json`)) as Manifest;
	const key = platform();
	const entry = manifest.platforms[key];
	if (entry === undefined) throw new Error(`${version} does not ship for ${key}`);

	const binary = join(workdir, `claude-${version}`);
	if (await exists(binary)) return binary;

	await mkdir(workdir, { recursive: true });
	const response = await fetch(`${BASE}/${version}/${key}/${entry.binary}.zst`);
	if (!response.ok || !(await unpack(response, `${binary}.zst`, binary))) {
		const plain = await fetch(`${BASE}/${version}/${key}/${entry.binary}`);
		if (!plain.ok) throw new Error(`${entry.binary}: ${plain.status} ${plain.statusText}`);
		await writeFile(binary, Buffer.from(await plain.arrayBuffer()));
	}
	await exec("chmod", ["+x", binary]);

	const digest = createHash("sha256")
		.update(await readFile(binary))
		.digest("hex");
	if (digest !== entry.checksum)
		throw new Error(`${key}: the binary hashes to ${digest}, not to ${entry.checksum}`);
	return binary;
}

/** Unpacks a `.zst`, saying whether this host has the `zstd` to do it. */
async function unpack(response: Response, packed: string, binary: string): Promise<boolean> {
	await writeFile(packed, Buffer.from(await response.arrayBuffer()));
	const done = await exec("zstd", ["-d", "-f", packed, "-o", binary]).then(
		() => true,
		() => false,
	);
	await rm(packed, { force: true });
	return done;
}

/**
 * The `z("name", "header")` pairs the binary keeps after the string `"claude_code"`.
 *
 * A build can spell a header as a constant instead, which the caller resolves.
 */
async function registry(binary: string): Promise<Feature[]> {
	const source = (await readFile(binary)).toString("latin1");
	const anchor = source.indexOf('"claude_code"');
	if (anchor < 0) throw new Error(`${binary} has no feature registry`);

	const window = source.slice(anchor - 40, anchor + 6_000);
	const features: Feature[] = [];
	let end = 0;
	for (const match of window.matchAll(
		/\(\s*"([a-z][a-z0-9_]*)"(?:\s*,\s*("[a-z0-9][a-z0-9.-]*"|[A-Za-z_$][\w$]*))?\s*\)/g,
	)) {
		if (match.index !== undefined && end !== 0 && match.index - end > 120) break;
		end = (match.index ?? 0) + match[0].length;

		const name = match[1];
		const found = match[2];
		if (name === undefined || found === undefined) continue;
		const resolved = found.startsWith('"') ? found.slice(1, -1) : constant(source, found);
		if (resolved !== undefined) features.push({ name, header: resolved, turn: false });
	}
	if (features.length < 20)
		throw new Error(`${binary} yielded ${features.length} features, which is too few to trust`);
	return features;
}

/** The string a build assigned to a name, for a header the registry spelled as a constant. */
function constant(source: string, name: string): string | undefined {
	const found = new RegExp(`${name.replace("$", "\\$")}="([a-z0-9][a-z0-9.-]*)"`).exec(source);
	return found?.[1];
}

interface Turn {
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

interface Block {
	type: string;
	text: string;
	cache_control?: unknown;
}

/**
 * Runs one turn of the TUI and keeps the request it sends. It types once the TUI has stopped drawing,
 * so it does not depend on how long a build takes to start.
 */
async function probeTurn(binary: string, prompt: string): Promise<Turn> {
	const home = await mkdtemp(join(tmpdir(), "claude-code-eval-"));
	const config = join(home, "config");
	await mkdir(config, { recursive: true });
	await writeFile(join(config, ".claude.json"), JSON.stringify(seed(home)));

	let turn: Turn | undefined;

	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const body = parse(Buffer.concat(chunks).toString("utf8"));
			if (request.method !== "POST" || body === undefined || !asks(body, prompt)) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end("{}");
				return;
			}
			turn ??= { headers: redact(request.headers), body };
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(STREAM);
		});
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (typeof address !== "object" || address === null) reject(new Error("no port"));
			else resolve(address.port);
		});
	});

	const command =
		process.platform === "darwin" ? ["-q", "/dev/null", binary] : ["-qec", binary, "/dev/null"];
	const child = spawn("script", command, {
		env: {
			...process.env,
			TERM: "xterm-256color",
			COLUMNS: "120",
			LINES: "40",
			CLAUDE_CONFIG_DIR: config,
			ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
			ANTHROPIC_API_KEY: KEY,
			DISABLE_TELEMETRY: "1",
			DISABLE_AUTOUPDATER: "1",
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		},
		cwd: home,
		detached: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stderr?.resume();

	try {
		await settled(child, READY, QUIET);
		child.stdin?.write(`${prompt}\r`);
		if (!(await arrived(() => turn !== undefined, Date.now() + TURN)) || turn === undefined)
			throw new Error(`no turn arrived within ${TURN} ms`);
		return turn;
	} finally {
		if (child.pid !== undefined) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				// already gone
			}
		}
		server.close();
		await rm(home, { recursive: true, force: true });
	}
}

/** What the TUI needs to skip its first run questions. */
function seed(cwd: string): Record<string, unknown> {
	return {
		hasCompletedOnboarding: true,
		theme: "dark",
		hasTrustDialogAccepted: true,
		customApiKeyResponses: { approved: [KEY], rejected: [] },
		projects: {
			[cwd]: {
				hasTrustDialogAccepted: true,
				allowedTools: [],
				hasCompletedProjectOnboarding: true,
			},
		},
	};
}

/** Resolves once the child has drawn something and then stopped drawing for `quiet` ms. */
function settled(child: ChildProcess, min: number, quiet: number): Promise<void> {
	return new Promise((resolve) => {
		let timer = setTimeout(resolve, min);
		child.stdout?.on("data", () => {
			clearTimeout(timer);
			timer = setTimeout(resolve, quiet);
		});
	});
}

/** A turn, in the shape the Messages API sends it. */
const STREAM = [
	`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_eval", type: "message", role: "assistant", model: "claude-eval", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })}`,
	`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
	`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } })}`,
	`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
	`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } })}`,
	`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
	"",
].join("\n\n");

/**
 * Whether the prompt went out as the user's own message, which is what makes a request the turn.
 *
 * A session also names itself with a smaller model, and that request carries the prompt too, inside a
 * `<session>` block, so a match on the text alone would take the naming request for the turn.
 */
function asks(body: Record<string, unknown>, prompt: string): boolean {
	if (!Array.isArray(body.messages)) return false;
	return body.messages.some((message) => {
		if (!isObject(message) || message.role !== "user" || !Array.isArray(message.content))
			return false;
		return message.content.some(
			(block) => isObject(block) && block.type === "text" && block.text === prompt,
		);
	});
}

function billing(system: Block[]): string | undefined {
	return system.find((block) => block.text.startsWith("x-anthropic-billing-header"))?.text;
}

/** The headers as strings, with anything that can sign a request taken out. */
function redact(headers: Record<string, string | string[] | undefined>): Record<string, string> {
	const keep: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		keep[name] =
			name === "authorization" || name === "x-api-key"
				? "<redacted>"
				: Array.isArray(value)
					? value.join(", ")
					: value;
	}
	return keep;
}

function header(headers: Record<string, string>, name: string): string {
	const value = headers[name];
	if (value === undefined) throw new Error(`the turn sent no ${name}`);
	return value;
}

function betasOf(headers: Record<string, string>, name: string): string[] {
	return header(headers, name)
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** The request body, or nothing when the request carried none. */
function parse(sent: string): Record<string, unknown> | undefined {
	if (sent === "") return undefined;
	try {
		const body: unknown = JSON.parse(sent);
		return isObject(body) ? body : undefined;
	} catch {
		return undefined;
	}
}

/** The text blocks of a `system` array, which is the only kind Claude Code sends. */
function blocks(system: unknown): Block[] {
	if (!Array.isArray(system)) throw new Error("the turn sent no system blocks");
	return system.filter(
		(block): block is Block =>
			isObject(block) && block.type === "text" && typeof block.text === "string",
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function text(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
	return response.text();
}

function exec(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(command, args, (error) => (error === null ? resolve() : reject(error)));
	});
}

async function exists(path: string): Promise<boolean> {
	return readFile(path).then(
		() => true,
		() => false,
	);
}

/** Waits for `ready` to hold, up to `deadline`. */
async function arrived(ready: () => boolean, deadline: number): Promise<boolean> {
	while (Date.now() < deadline && !ready()) await sleep(POLL);
	return ready();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			version: { type: "string" },
			channel: { type: "string", default: "latest" },
			workdir: { type: "string", default: join(tmpdir(), "claude-code-eval") },
		},
	});
	const version = values.version ?? (await channelVersion(values.channel as Channel));
	console.log(JSON.stringify(await capture(version, values.workdir), null, 2));
}
