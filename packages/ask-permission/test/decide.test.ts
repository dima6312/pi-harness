import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { toolInfo } from "@adeildo/pi-kit/testing";

import { defaultConfig } from "#core/config/schema.ts";
import {
	decide,
	type Decision,
	describeCall,
	type GateState,
	gateLayers,
	type Layer,
} from "#core/decide.ts";
import type { McpPolicy } from "#core/mcp.ts";
import type { PermissionMode } from "#core/mode.ts";

const CWD = tmpdir();

function gate(overrides: Partial<GateState> = {}): GateState {
	return {
		config: defaultConfig(),
		mode: "manual",
		outside: "ask",
		alwaysYes: { has: () => false },
		folders: { covers: () => false },
		...overrides,
	};
}

async function decision(
	toolName: string,
	input: unknown,
	state: GateState = gate(),
	extra: Layer[] = [],
): Promise<Decision> {
	const call = describeCall(toolName, input, CWD, state.config);
	return decide(call, [...gateLayers(state), ...extra]);
}

async function decidedBy(
	toolName: string,
	input: unknown,
	state?: GateState,
	extra?: Layer[],
): Promise<string | undefined> {
	const result = await decision(toolName, input, state, extra);
	return "by" in result ? result.by : undefined;
}

const judge: Layer = { name: "judge", decide: () => ({ action: "allow" }) };

describe("decide", () => {
	test("always yes wins before anything else", async () => {
		const state = gate({ alwaysYes: { has: () => true } });
		expect(await decidedBy("bash", { command: "cat /etc/passwd" }, state)).toBe("always yes");
	});

	test("a call its tool always asks about comes to you in every mode, past any always yes", async () => {
		const custom = new Map([
			["peers", { alwaysAsks: (input: Record<string, unknown>) => input.action === "link" }],
		]);
		const state = gate({ mode: "full", alwaysYes: { has: () => true } });
		const asked = (input: unknown) =>
			decide(describeCall("peers", input, CWD, state.config, { custom }), [
				...gateLayers(state),
				judge,
			]);
		expect(await asked({ action: "link", folder: "../backend" })).toMatchObject({
			action: "ask",
			by: "always asks",
		});
		expect(await asked({ action: "send", text: "hi" })).toMatchObject({ action: "allow" });
	});

	test.each<[PermissionMode, string, unknown, string | undefined]>([
		["manual", "read", { path: "a.ts" }, "allow list"],
		["manual", "bash", { command: "git status" }, "read-only bash"],
		["manual", "write", { path: "a.ts" }, undefined],
		["manual", "bash", { command: "rm -rf build" }, undefined],
		["edits", "write", { path: "a.ts" }, "mode"],
		["edits", "edit", { path: "a.ts" }, "mode"],
		["edits", "read", { path: "a.ts" }, "allow list"],
		["edits", "bash", { command: "rm -rf build" }, undefined],
		["judge", "edit", { path: "a.ts" }, "mode"],
		["judge", "bash", { command: "git status" }, "read-only bash"],
		["judge", "bash", { command: "rm -rf build" }, undefined],
		["full", "bash", { command: "rm -rf build" }, "mode"],
		["full", "codemode", { code: "x" }, "codemode"],
	])("%s: %s %j decides by %s", async (mode, toolName, input, layer) => {
		expect(await decidedBy(toolName, input, gate({ mode }))).toBe(layer);
	});

	test("full runs everything, the allow list and read-only bash off included", async () => {
		const config = { ...defaultConfig(), allow: [], readOnlyBash: false };
		expect(await decidedBy("read", { path: "a.ts" }, gate({ mode: "full", config }))).toBe("mode");
	});

	test("a later layer runs only when the earlier ones pass", async () => {
		const seen: string[] = [];
		const spy: Layer = {
			name: "spy",
			decide: (call) => {
				seen.push(call.target.summary);
				return undefined;
			},
		};

		await decidedBy("bash", { command: "git status" }, gate(), [spy]);
		await decidedBy("bash", { command: "rm -rf build" }, gate(), [spy]);
		expect(seen).toEqual(["rm -rf build"]);
	});
});

describe("the workspace, in every mode", () => {
	const modes: PermissionMode[] = ["manual", "edits", "judge", "full"];

	test.each(modes)("%s asks before a path outside, and the judge never sees it", async (mode) => {
		const result = await decision("bash", { command: "rm /etc/hosts" }, gate({ mode }), [judge]);
		expect(result).toEqual({
			action: "ask",
			reason: "outside the workspace (/etc/hosts)",
			by: "workspace",
		});
	});

	test.each(modes)("%s blocks a path outside when the session denies it", async (mode) => {
		const state = gate({ mode, outside: "deny" });
		const result = await decision("write", { path: "/etc/hosts" }, state);
		expect(result.action).toBe("block");
	});

	test("with outside allow, the mode decides wherever the call goes", async () => {
		const state = gate({ mode: "full", outside: "allow" });
		expect(await decidedBy("bash", { command: "cat /etc/passwd" }, state)).toBe("mode");
		const edits = gate({ mode: "edits", outside: "allow" });
		expect(await decidedBy("edit", { path: "/etc/hosts" }, edits)).toBe("mode");
	});

	test("redirects to /dev/null and URLs do not leave the workspace", async () => {
		const state = gate({ mode: "full" });
		expect(await decidedBy("bash", { command: "bun test 2>/dev/null" }, state)).toBe("mode");
		expect(await decidedBy("bash", { command: "ls >/dev/stdout" }, state)).toBe("mode");
		expect(await decidedBy("bash", { command: "curl -sS https://example.com/a" }, state)).toBe(
			"mode",
		);
	});

	test("a command whose paths cannot be read leaves in manual and edits only", async () => {
		const command = { command: 'cat "$HOME/.ssh/id_rsa"' };
		const results = await Promise.all(
			(["manual", "edits"] as const).map((mode) =>
				decision("bash", command, gate({ mode }), [judge]),
			),
		);
		for (const result of results) {
			expect(result).toEqual({
				action: "ask",
				reason: "cannot tell which paths this command reaches",
				by: "workspace",
			});
		}
		expect(await decidedBy("bash", command, gate({ mode: "judge" }), [judge])).toBe("judge");
		expect(await decidedBy("bash", command, gate({ mode: "full" }))).toBe("mode");
	});
});

describe("the MCP policy", () => {
	const reads = toolInfo("mcp__sauron__query_loki_logs", {
		namespace: { name: "mcp__sauron" },
		annotations: { readOnlyHint: true },
	});
	const destructive = toolInfo("mcp__sauron__delete_dashboard", {
		namespace: { name: "mcp__sauron" },
		annotations: { destructiveHint: true },
	});
	const silent = toolInfo("mcp__dorothy__list_domains", { namespace: { name: "mcp__dorothy" } });
	const all = [reads, destructive, silent];
	const facts = (toolName: string) => all.find((tool) => tool.name === toolName);

	function mcpGate(policies: Record<string, McpPolicy> = {}, mode: PermissionMode = "manual") {
		return gate({ config: { ...defaultConfig(), mcp: { servers: policies } }, mode });
	}

	async function mcpDecidedBy(
		toolName: string,
		state: GateState,
		extra: Layer[] = [],
		nested = false,
	): Promise<string | undefined> {
		const call = describeCall(toolName, { dashboard: "x" }, CWD, state.config, { facts, nested });
		const result = await decide(call, [...gateLayers(state), ...extra]);
		return "by" in result ? result.by : undefined;
	}

	test("a call the server says only reads runs, and the others do not", async () => {
		expect(await mcpDecidedBy(reads.name, mcpGate())).toBe("read-only hint");
		expect(await mcpDecidedBy(destructive.name, mcpGate())).toBeUndefined();
		expect(await mcpDecidedBy(silent.name, mcpGate())).toBeUndefined();
	});

	test("a server that declares nothing is judged, not trusted", async () => {
		expect(await mcpDecidedBy(silent.name, mcpGate({}, "judge"), [judge])).toBe("judge");
	});

	test("allow runs every call of the server, destructive included", async () => {
		expect(await mcpDecidedBy(destructive.name, mcpGate({ sauron: "allow" }))).toBe("mcp");
	});

	test("ask asks for every call, even in full and even for a read", async () => {
		const state = mcpGate({ sauron: "ask" }, "full");
		expect(await mcpDecidedBy(reads.name, state)).toBe("mcp");
		expect(await mcpDecidedBy(destructive.name, state)).toBe("mcp");
	});

	test("deny blocks, and outranks the mode", async () => {
		const state = mcpGate({ sauron: "deny" }, "full");
		const result = await mcpDecidedBy(reads.name, state);
		expect(result).toBe("mcp");

		const call = describeCall(reads.name, {}, CWD, state.config, { facts });
		const verdict = await decide(call, gateLayers(state));
		expect(verdict).toMatchObject({ action: "block", by: "mcp" });
	});

	test("one server's policy leaves the others alone", async () => {
		const state = mcpGate({ sauron: "deny" });
		expect(await mcpDecidedBy(reads.name, state)).toBe("mcp");
		expect(await mcpDecidedBy(silent.name, state)).toBeUndefined();
	});

	test("the policy also decides a call a script issued", async () => {
		expect(
			await mcpDecidedBy(destructive.name, mcpGate({ sauron: "deny" }, "full"), [], true),
		).toBe("mcp");
		expect(await mcpDecidedBy(destructive.name, mcpGate(), [], true)).toBeUndefined();
	});

	test("a script and a search run without asking, wherever they sit", async () => {
		expect(await mcpDecidedBy("codemode", mcpGate(), [], true)).toBe("codemode");
		expect(await mcpDecidedBy("tool_search", mcpGate())).toBe("codemode");
	});

	test("always yes has the last word, and names the tool as the dialog shows it", async () => {
		const call = describeCall(reads.name, { dashboard: "x" }, CWD, defaultConfig(), { facts });
		expect(call.target.levels).toEqual(["sauron:query_loki_logs"]);

		const state = gate({
			alwaysYes: { has: (_toolName, levels) => levels.includes("sauron:query_loki_logs") },
		});
		expect(await mcpDecidedBy(reads.name, state)).toBe("always yes");
	});
});
