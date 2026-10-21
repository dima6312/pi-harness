import type { Control, FeatureScope, Json, ScreenEntry } from "@adeildo/pi-kit";
import { tildify } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Scope, SCOPE_LABEL } from "#core/always-yes.ts";
import { isMcpPolicy, isOutsideScope } from "#core/config/schema.ts";
import {
	MCP_POLICY_CONTROL,
	MODE_CONTROL,
	OUTSIDE_CONTROL,
	readDryRun,
	readRigor,
	setMcpPolicy,
	writeDryRun,
	writeRigor,
} from "#core/config/settings.ts";
import { globalAlwaysYesPath, projectAlwaysYesPath } from "#core/config/store.ts";
import { describeRigor, JUDGE_RIGORS, type JudgeRigor } from "#core/judge/config.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { MCP_POLICY_TEXT, type McpServer, mcpServers, policyFor, sameServer } from "#core/mcp.ts";
import { parseMode } from "#core/mode.ts";
import { renderStatus, setSessionMode, setSessionOutside } from "#pi/mode.ts";
import { closeFolders, forgetAlwaysYes, resetJudgeHealth, type SessionState } from "#pi/session.ts";

export function registerScreen(scope: FeatureScope, state: SessionState): void {
	scope.screen.rows(() => mcpRows(scope, state));

	scope.screen.value({
		id: "session.mode",
		section: "This session",
		label: "Mode",
		description: "Which calls run without asking, until the session ends. Alt+M cycles it.",
		control: MODE_CONTROL,
		get: () => state.mode,
		set: (value, ctx) => {
			const mode = typeof value === "string" ? parseMode(value) : undefined;
			if (mode === undefined) return "not a mode";
			setSessionMode(scope, state, mode, ctx, false);
			return undefined;
		},
	});

	scope.screen.value({
		id: "session.outside",
		section: "This session",
		label: "Outside the workspace",
		description: "What a call outside the workspace does, until the session ends. Alt+W flips it.",
		control: OUTSIDE_CONTROL,
		get: () => state.outside,
		set: (value, ctx) => {
			if (!isOutsideScope(value)) return "not an outside policy";
			setSessionOutside(scope, state, value, ctx, false);
			return undefined;
		},
	});

	scope.screen.value({
		id: "judge.rigor",
		section: "Judge",
		label: "Rigor",
		description:
			"How sure the judge must be before a call runs without you. Below that, it asks you.",
		meta: "saved for every project",
		control: () => rigorControl(readRigor(scope)),
		get: () => readRigor(scope),
		set: (value) => {
			if (value === "custom")
				return "custom is what judge.thresholds and judge.riskCeiling set by hand";
			if (!isRigor(value)) return "not a rigor";
			return writeRigor(scope, value);
		},
	});

	scope.screen.value({
		id: "judge.dryRun",
		section: "Judge",
		label: "Dry run",
		description:
			"The judge shows its verdict, and you still decide. Try a policy or a rigor this way first.",
		meta: "saved for every project",
		control: { type: "toggle" },
		get: () => readDryRun(scope),
		set: (value) => (typeof value === "boolean" ? writeDryRun(scope, value) : "expected on or off"),
	});

	scope.screen.action({
		id: "judge.test",
		section: "Judge",
		label: "Test the judge",
		description:
			"Sends one real request with the settings above, and reports the model and the time.",
		run: (ctx) => testJudge(state, ctx),
	});

	scope.screen.action({
		id: "judge.log",
		section: "Judge",
		label: "This session's verdicts",
		description: "The last calls the judge decided in this session.",
		text: () => (state.judgeLog.length === 0 ? "none yet" : `${state.judgeLog.length}`),
		run: () => judgeLogText(state.judgeLog),
	});

	for (const where of ["session", "project", "global"] as const) {
		scope.screen.action({
			id: `always-yes.${where}`,
			section: "Always yes",
			label: capitalize(SCOPE_LABEL[where]),
			description: alwaysYesDescription(where),
			text: () => count(state.alwaysYes.size(where)),
			confirm: `Forget every always yes for ${SCOPE_LABEL[where]}?`,
			run: (ctx) => forget(scope, state, ctx, where),
		});
	}

	for (const where of ["session", "project", "global"] as const) {
		scope.screen.action({
			id: `folders.${where}`,
			section: "Folders",
			label: capitalize(SCOPE_LABEL[where]),
			description: `Folders outside the workspace you opened from the dialog, ${SCOPE_LABEL[where]}. A call that reaches only these counts as inside. Enter closes them.`,
			text: () => foldersText(state, where),
			confirm: `Close every folder open for ${SCOPE_LABEL[where]}?`,
			run: (ctx) => close(scope, state, ctx, where),
		});
	}
}

// One row per server pi is connected to, plus any server the settings still name. The rows are
// built when the screen opens, because a server connects after the session starts.
function mcpRows(scope: FeatureScope, state: SessionState): ScreenEntry[] {
	const connected = mcpServers(scope.getAllTools());
	const gone = Object.keys(state.config.mcp.servers).filter(
		(name) => !connected.some((entry) => sameServer(entry.server, name)),
	);

	if (connected.length === 0 && gone.length === 0) {
		return [
			{
				kind: "info",
				id: "mcp.none",
				section: "MCP servers",
				label: "Servers",
				description:
					"The MCP servers pi connects to. Each one follows the policy set here, whatever the mode.",
				text: () => "none connected",
			},
		];
	}

	return [
		...connected.map((entry) => mcpRow(scope, state, entry.server, entry)),
		...gone.map((server) => mcpRow(scope, state, server)),
	];
}

function mcpRow(
	scope: FeatureScope,
	state: SessionState,
	server: string,
	connected?: McpServer,
): ScreenEntry {
	const policy = policyFor(state.config.mcp.servers, server);

	return {
		kind: "value",
		id: `mcp.${server}`,
		section: "MCP servers",
		label: server,
		description: `${describeServer(connected)}. ${capitalize(MCP_POLICY_TEXT[policy].description)}.`,
		meta: "saved for every project",
		control: MCP_POLICY_CONTROL,
		get: () => policy,
		set: (value: Json) => {
			if (!isMcpPolicy(value)) return "not an MCP policy";
			return setMcpPolicy(scope, server, value);
		},
	};
}

function describeServer(server: McpServer | undefined): string {
	if (server === undefined) return "not connected now, so the policy waits";
	const tools = server.tools === 1 ? "1 tool" : `${server.tools} tools`;
	return `${tools}, ${server.reads} that read, ${server.destructive} destructive`;
}

function isRigor(value: Json): value is JudgeRigor {
	return JUDGE_RIGORS.some((rigor) => rigor === value);
}

// `custom` is listed only while it is the value, so the row can show it.
function rigorControl(current: JudgeRigor | "custom"): Control {
	const options: { value: string; description: string }[] = JUDGE_RIGORS.map((value) => ({
		value,
		description: describeRigor(value),
	}));
	if (current === "custom")
		options.push({
			value: "custom",
			description:
				"the settings file sets judge.thresholds or judge.riskCeiling. Pick a rigor to drop them",
		});
	return { type: "choice", options };
}

// With one folder open, the row names it.
function foldersText(state: SessionState, where: Scope): string {
	const [first, ...rest] = state.folders.list(where);
	if (first === undefined) return "none";
	if (rest.length > 0) return `${rest.length + 1} folders`;
	return first.access === "read" ? `${tildify(first.path)}, reads` : tildify(first.path);
}

function close(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	where: Scope,
): string | undefined {
	const removed = closeFolders(scope, state, ctx, where);
	if (removed === 0) throw new Error(`no folder open for ${SCOPE_LABEL[where]}`);
	renderStatus(ctx, state);
	return undefined;
}

async function testJudge(state: SessionState, ctx: ExtensionContext): Promise<string> {
	const judge = state.config.judge;
	const probe = await probeJudge(judge, ctx.modelRegistry, ctx.signal);
	if (!probe.ok) throw new Error(`the judge failed: ${probe.detail}`);

	resetJudgeHealth(state);
	const lines = [`The judge answered in ${probe.elapsedMs}ms, with ${probe.model ?? judge.model}.`];
	if (probe.elapsedMs > judge.timeoutMs) {
		lines.push(
			"",
			`That is slower than the ${judge.timeoutMs}ms timeout, so real calls would come to you. Raise the timeout.`,
		);
	}
	return lines.join("\n");
}

function forget(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	where: Scope,
): string | undefined {
	const removed = forgetAlwaysYes(scope, state, ctx, where);
	if (removed === 0) throw new Error(`nothing to forget for ${SCOPE_LABEL[where]}`);
	return undefined;
}

function alwaysYesDescription(where: Scope): string {
	switch (where) {
		case "session":
			return "Rules for this session. Enter forgets them.";
		case "project":
			return `Rules for this project, in ${projectAlwaysYesPath(".")}. Enter forgets them.`;
		case "global":
			return `Rules for every project, in ${tildify(globalAlwaysYesPath())}. Enter forgets them.`;
	}
}

function count(size: number): string {
	return size === 1 ? "1 rule" : `${size} rules`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
