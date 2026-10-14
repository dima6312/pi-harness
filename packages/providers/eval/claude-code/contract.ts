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
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
	/** What enabling it changes, from the binary and from the turn captured here. */
	description: string;
}

/**
 * What each feature does, in the words of the request it travels with.
 *
 * Claude Code carries no description of its own: the `.describe()` strings in the binary belong to
 * telemetry events, and a build only pairs a name with a header. What the notes below come from is
 * the field each feature is pushed beside, the endpoint it belongs to, and the docs the binary ships.
 */
const NOTES: Record<string, string> = {
	"claude-code-20250219":
		"marks the request as Claude Code's, which is where Anthropic reads the plan from",
	"oauth-2025-04-20": "goes beside an OAuth token, so dropping it moves the request off that path",
	"interleaved-thinking-2025-05-14":
		"thinking carries on between tool calls instead of stopping at each one",
	"context-1m-2025-08-07": "the million token context window, on the models that have it",
	"context-management-2025-06-27":
		"travels with `context_management`, the edits that clear old tool results",
	"structured-outputs-2025-12-15": "travels with `output_config.format`, which pi never sends",
	"web-search-2025-03-05": "Vertex and Foundry only, where the server runs the search",
	"advanced-tool-use-2025-11-20": "tools load on demand instead of all at once",
	"tool-search-tool-2025-10-19": "the earlier name of that same tool search",
	"effort-2025-11-24": "travels with `output_config.effort`",
	"task-budgets-2026-03-13": "travels with `task_budget`, which pi never sends",
	"prompt-caching-scope-2026-01-05":
		"changes what the cache covers, and nothing in the request itself",
	"prompt-caching-evict-2026-05-12": "travels with `evict_on_complete`, which pi never sends",
	"cache-keepalive-2026-09-03":
		"used on the call that keeps a cached conversation alive, not on a request for a reply",
	"extended-cache-ttl-2025-04-11": "a one hour `cache_control.ttl` is only honoured with it",
	"fast-mode-2026-02-01": 'travels with `speed: "fast"`, which pi never sends',
	"redact-thinking-2026-02-12": "hides the thinking of earlier turns from the model",
	"thinking-resumption-2026-07-17": "thinking picks up where an earlier request left it",
	"thinking-token-count-2026-05-13": "adds thinking counts to the usage the reply reports",
	"afk-mode-2026-01-31": "the server acts on it, and nothing in the request changes",
	"advisor-tool-2026-03-01": "the advisor tool, which asks a second model for advice",
	"cache-diagnosis-2026-04-07":
		"the reply says what the cache did; Claude Code drops this one when the API refuses it",
	"context-hint-2026-04-09": "the server acts on it, and nothing in the request changes",
	"mcp-servers-2025-12-04": "only used on the MCP server endpoints, so a reply is unaffected",
	"files-api-2025-04-14": "only used on the Files endpoints, so a reply is unaffected",
	"environments-2025-11-01": "only used on the environments endpoints, so a reply is unaffected",
	"ccr-byoc-2025-07-29": "only used on the code runner endpoints, so a reply is unaffected",
	"per-turn-control-2026-07-01": "travels with the per turn control fields",
	"timing-2026-09-09": "asks the reply to say how long the request took",
	"mid-conversation-tool-changes-2026-07-01":
		"lets the tool list change in the middle of a conversation",
	"inline-tools-2026-09-15":
		"tool definitions travel inside the messages instead of the `tools` field",
	"server-side-fallback-2026-06-01": "travels with `fallbacks`",
	"server-side-fallback-2026-07-01": "travels with `fallbacks`, by category",
	"fallback-credit-2026-06-01": "counts a fallback against a credit",
	"auto-mode-classifier-2026-07-16": "the classifier that decides the auto mode",
	"dangerous-tool-use-2026-09-03": "travels with `safeguards`",
	"thinking-display-updates-2026-08-18": "streams updates to how thinking is displayed",
	"message-threads-2026-08-12": "only used on the thread endpoints, so a reply is unaffected",
	"thinking-binding-controls-2026-08-01": "travels with `thinking.block_binding`",
	"mid-conversation-system-clear-at-2026-08-21": "lets a system block be cleared mid conversation",
};

/** The ones pi asks for by itself, which the settings therefore cannot take away. */
const PI_ASKS = new Set([
	"claude-code-20250219",
	"oauth-2025-04-20",
	"interleaved-thinking-2025-05-14",
	"server-side-fallback-2026-07-01",
	"thinking-binding-controls-2026-08-01",
	"inline-tools-2026-09-15",
]);

/**
 * The gate each feature sits behind, from the `{beta, when}` table a build keeps beside the registry.
 *
 * The predicate is minified but the names it tests are not, so the class comes from the identifiers
 * in the window rather than from reading the expression. A window with none of them is left out
 * instead of guessed at.
 */
const GATES: readonly (readonly [string, string])[] = [
	["firstPartyOnlyBetas", "Anthropic's own API only."],
	["firstPartyCapabilityBetas", "Only when the account has the capability."],
	["experimentalBetasOff", "Off once experimental betas are disabled."],
	["vertex", "Vertex and Foundry only."],
	["bedrock", "Bedrock and Mantle only."],
	["perTurnTiming", "Only when per turn timing is on."],
	["interleavedThinking", "Only while thinking is on."],
	["haiku", "Not sent for Haiku."],
];

/** The class of gate each header sits behind, when the build states one. */
function gates(source: string, declared: readonly Declaration[]): Map<string, string> {
	const known = new Map(declared.map(({ variable, header }) => [variable, header]));
	const found = new Map<string, string>();
	for (const match of source.matchAll(/\{beta:([A-Za-z_$][\w$]*),when:/g)) {
		const header = known.get(match[1] ?? "");
		if (header === undefined || match.index === undefined) continue;
		// The predicate ends at the object's own brace, and reaching past it reads the next feature's
		// gate instead of this one.
		const close = source.indexOf("}", match.index);
		const identifiers = new Set(
			source.slice(match.index, close === -1 ? match.index + 200 : close).split(/[^A-Za-z0-9_$]+/),
		);
		for (const [keyword, phrase] of GATES)
			if (identifiers.has(keyword)) {
				found.set(header, phrase);
				break;
			}
	}
	return found;
}

function describe(header: string, gate: string | undefined): string {
	const note = NOTES[header] ?? "nothing in this build says what it does";
	const sentence = `${note.charAt(0).toUpperCase()}${note.slice(1)}.`;
	const parts = [gate, sentence].filter((part) => part !== undefined);
	if (PI_ASKS.has(header))
		parts.push("Pi already asks for this one, so this switch cannot turn it off.");
	return parts.join(" ");
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
	const source = (await readFile(binary)).toString("latin1");

	const declared = declarations(source);
	const gated = gates(source, declared);
	const system = blocks(turn.body.system);
	const betas = new Set(betasOf(turn.headers, "anthropic-beta"));
	const features = declared.map(({ name, header }) => ({
		name,
		header,
		turn: betas.has(header),
		description: describe(header, gated.get(header)),
	}));

	return {
		version,
		userAgent: headerOf(turn.headers, "user-agent"),
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

interface Declaration {
	name: string;
	header: string;
	/** The minified variable holding it, which is what a gate table names. */
	variable: string;
}

/**
 * The feature declarations a build keeps together, as `VAR=z("name", "header")`.
 *
 * The list right after the string `"claude_code"` is a list of those variables, so this reads the
 * same set from the side that also gives the variable a gate names. A header a build spelled as a
 * constant resolves from that constant's own assignment.
 */
function declarations(source: string): Declaration[] {
	const anchor = source.indexOf('"claude_code"');
	if (anchor < 0) throw new Error("this build has no feature registry");

	const window = source.slice(anchor - 200, anchor + 6_000);
	const pair =
		/([A-Za-z_$][\w$]*)=z\("([a-z][a-z0-9_]*)",\s*("[a-z0-9][a-z0-9.-]*"|[A-Za-z_$][\w$]*)\)/g;
	const found: Declaration[] = [];
	for (const match of window.matchAll(pair)) {
		const variable = match[1];
		const name = match[2];
		const spelled = match[3];
		if (variable === undefined || name === undefined || spelled === undefined) continue;
		const header = spelled.startsWith('"') ? spelled.slice(1, -1) : constant(source, spelled);
		// `x-cc-internal-` headers are latches between Claude Code's own processes, not features.
		if (header === undefined || header.startsWith("x-cc-internal-")) continue;
		found.push({ name, header, variable });
	}
	if (found.length < 20)
		throw new Error(`this build yielded ${found.length} features, which is too few to trust`);
	return found;
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

function headerOf(headers: Record<string, string>, name: string): string {
	const value = headers[name];
	if (value === undefined) throw new Error(`the turn sent no ${name}`);
	return value;
}

function betasOf(headers: Record<string, string>, name: string): string[] {
	return headerOf(headers, name)
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
	return access(path).then(
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
