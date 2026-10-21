// The first layer with an answer decides, so the order is the policy. The caller adds the judge.

import { tildify } from "@adeildo/pi-kit";
import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";

import type { AlwaysYes } from "#core/always-yes.ts";
import { isAllowed } from "#core/config/patterns.ts";
import type { OutsideScope, PermissionConfig } from "#core/config/schema.ts";
import type { Access, OpenFolders } from "#core/folders.ts";
import {
	hintsOf,
	isOrchestrator,
	type McpCall,
	type McpPolicy,
	mcpCallOf,
	policyFor,
	type ToolFacts,
} from "#core/mcp.ts";
import { MODES, type ModeRules, type PermissionMode } from "#core/mode.ts";
import {
	asToolInput,
	type CallDescriptor,
	type CustomTools,
	isBuiltInTool,
	type ToolAdapter,
	toolAdapter,
	type ToolInput,
} from "#core/tools.ts";
import { type Reach, reachOf } from "#core/workspace.ts";
import { NAME } from "#identity";

export interface Call {
	toolName: string;
	input: ToolInput;
	target: CallDescriptor;
	tool: ToolAdapter;
	reach: Reach;
	/** Set for a call to an MCP server. */
	mcp?: McpCall;
	/** What the tool declares about itself, whatever registered it. */
	hints: ToolAnnotations;
	/** Issued by another tool, as in a codemode script, not by the model. */
	nested: boolean;
	/** What an extension's tool says it does, unverified. Unset for the built-in tools. */
	description?: string;
}

export type Verdict =
	| { action: "allow" }
	| { action: "block"; reason: string }
	| { action: "ask"; reason?: string };

export type Decision = (Verdict & { by: string }) | { action: "ask" };

export interface Layer {
	name: string;
	decide(call: Call): Verdict | undefined | Promise<Verdict | undefined>;
}

export interface GateState {
	config: PermissionConfig;
	mode: PermissionMode;
	outside: OutsideScope;
	alwaysYes: Pick<AlwaysYes, "has">;
	folders: Pick<OpenFolders, "covers">;
}

const ALLOW: Verdict = { action: "allow" };

/** What the caller knows about the tool itself, which the input does not say. */
export interface CallExtras {
	/** Adapters other extensions registered over `pi-ask-permission:tool`. */
	custom?: CustomTools;
	facts?: ToolFacts;
	/** The call came from another tool. */
	nested?: boolean;
}

export function describeCall(
	toolName: string,
	rawInput: unknown,
	cwd: string,
	config: PermissionConfig,
	extras: CallExtras = {},
): Call {
	const input = asToolInput(rawInput);
	const tool = toolAdapter(toolName, extras.custom);
	const reach = reachOf(config.workspace.roots, cwd, tool.paths(input));
	const fact = extras.facts?.(toolName);
	const mcp = mcpCallOf(toolName, fact);
	const target = tool.describe(input);

	return {
		toolName,
		input,
		tool,
		// The registered name is `mcp__<server>__<tool>`; the caller reads it as `sauron:query`.
		target: mcp ? { ...target, levels: [`${mcp.server}:${mcp.tool}`] } : target,
		reach,
		mcp,
		hints: hintsOf(fact),
		nested: extras.nested === true,
		description: isBuiltInTool(toolName) ? undefined : fact?.description,
	};
}

export function gateLayers(state: GateState): Layer[] {
	const rules = MODES[state.mode];
	return [
		{
			// Before everything, an always yes included: the tool keeps these calls with you.
			name: "always asks",
			decide: (call) =>
				call.tool.alwaysAsks?.(call.input) === true
					? { action: "ask", reason: "this tool keeps these calls with you" }
					: undefined,
		},
		{
			name: "always yes",
			decide: (call) =>
				state.alwaysYes.has(call.toolName, call.target.levels) ? ALLOW : undefined,
		},
		{
			// A script and a search are a way of calling other tools, and each of those calls reaches
			// the gate on its own. Asking about the wrapper would ask twice for one thing.
			name: "codemode",
			decide: (call) => (isOrchestrator(call.toolName) ? ALLOW : undefined),
		},
		{
			name: "workspace",
			decide: (call) => workspaceVerdict(call, rules, state),
		},
		{
			name: "mcp",
			decide: (call) => mcpVerdict(call, state.config.mcp.servers),
		},
		{
			// A tool the author says only reads is not worth asking about. The hint is not verified,
			// which is why a server can still be told to ask for everything.
			name: "read-only hint",
			decide: (call) => (call.hints.readOnlyHint === true ? ALLOW : undefined),
		},
		{
			name: "mode",
			decide: (call) =>
				rules.everything || (rules.edits && call.tool.edits === true) ? ALLOW : undefined,
		},
		{
			name: "allow list",
			decide: (call) => (isAllowed(state.config, call.toolName) ? ALLOW : undefined),
		},
		{
			name: "read-only bash",
			decide: (call) => (isReadOnlyBash(call, state) ? ALLOW : undefined),
		},
	];
}

export async function decide(call: Call, layers: Layer[]): Promise<Decision> {
	for (const layer of layers) {
		// oxlint-disable-next-line no-await-in-loop -- a layer runs only when the earlier ones passed.
		const verdict = await layer.decide(call);
		if (verdict) return { ...verdict, by: layer.name };
	}
	return { action: "ask" };
}

/** What the call does where it lands: a read-only call only reads. */
export function accessOf(call: Call): Access {
	if (call.tool.onlyReads === true) return "read";
	return call.tool.readOnly?.(call.input) === true ? "read" : "write";
}

// The server's policy runs before the mode, so a denied server stays denied in every mode, and an
// allowed one skips the judge. `hints` decides nothing here: it lets the read-only layer in.
function mcpVerdict(call: Call, servers: Readonly<Record<string, McpPolicy>>): Verdict | undefined {
	if (call.mcp === undefined) return undefined;

	switch (policyFor(servers, call.mcp.server)) {
		case "allow":
			return ALLOW;
		case "deny":
			return {
				action: "block",
				reason: `${NAME}: every call to the MCP server "${call.mcp.server}" is denied here`,
			};
		case "ask":
			return { action: "ask", reason: `every call to ${call.mcp.server} asks` };
		case "hints":
			return undefined;
	}
}

// Asking here keeps the judge from approving a call that left.
function workspaceVerdict(
	call: Call,
	rules: ModeRules,
	state: Pick<GateState, "outside" | "folders">,
): Verdict | undefined {
	if (call.reach.kind === "outside") {
		const access = accessOf(call);
		if (call.reach.paths.every((path) => state.folders.covers(path, access))) return undefined;
	}

	const reason = leavingReason(call.reach, rules);
	if (reason === undefined || state.outside === "allow") return undefined;
	if (state.outside === "deny") return { action: "block", reason: `${NAME}: ${reason}` };
	return { action: "ask", reason };
}

function leavingReason(reach: Reach, rules: ModeRules): string | undefined {
	switch (reach.kind) {
		case "inside":
			return undefined;
		case "outside":
			return `outside the workspace (${tildify(reach.path)})`;
		case "unknown":
			return rules.unknownIsOutside ? "cannot tell which paths this command reaches" : undefined;
	}
}

// `cat "$HOME/.ssh/id_rsa"` only reads, but nothing here can tell what. The judge decides it.
function isReadOnlyBash(call: Call, state: GateState): boolean {
	if (!state.config.readOnlyBash) return false;
	if (call.reach.kind === "unknown" && state.outside !== "allow") return false;
	return call.tool.readOnly?.(call.input) === true;
}
