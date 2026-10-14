// Draws tool calls the way a session shows them: pi's own renderer for the tool, the look's frame
// around it, and the decision answered the way the permission feature answers it.
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	initTheme,
	ToolExecutionComponent,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { ASK_RENDERERS } from "../../packages/ask-questions/src/ui/transcript.ts";
import { RULING } from "../../packages/kit/src/contracts/calls.ts";
import { createApp, type CallRuling } from "../../packages/kit/src/index.ts";
import { fakePi } from "../../packages/kit/src/testing.ts";
import { look } from "../../packages/look/src/index.ts";

export interface CallSpec {
	tool: "bash" | "read" | "edit" | "write" | "ask_questions";
	args: Record<string, unknown>;
	/** What the call printed. Without it the call is drawn as one that has not answered yet. */
	output?: string;
	/** What the tool kept beside its output, for the tools that draw from it. */
	details?: unknown;
	/** The model is still writing the call. */
	writing?: boolean;
	/** How long the model took to write the call. */
	wroteMs: number;
	/** How long the call ran, or has run so far. */
	ranMs: number;
	/** Still running, so the frame closes with the time so far instead of the end of the call. */
	running?: boolean;
	error?: boolean;
	ruling?: CallRuling;
}

// The tool definitions are typed for their own arguments, and the drawing only passes them on.
const TOOLS = {
	bash: createBashToolDefinition("/repo"),
	read: createReadToolDefinition("/repo"),
	edit: createEditToolDefinition("/repo"),
	write: createWriteToolDefinition("/repo"),
	ask_questions: ASK_RENDERERS,
} as Record<CallSpec["tool"], ToolRenderers>;

/**
 * A call as a session draws it. A picture needs numbers on it, so the clock is moved by hand
 * instead of waited on, and the ruling is answered here the way the permission feature answers
 * it on the bus.
 */
export function drawCall(spec: CallSpec, width: number): string[] {
	// The frame reads the theme pi holds globally, and the pictures use pi's own dark theme.
	initTheme("dark", false);
	const real = Date.now;
	let behind = 0;
	// A fixed start, so what moves with time, as the stretch along a running call's rule, draws the same.
	const start = Date.UTC(2026, 0, 1);
	Date.now = () => start + behind;

	try {
		const base = TOOLS[spec.tool];
		const fake = fakePi();
		createApp(fake.pi, { name: "docs" }).use(look).build();
		fake.pi.events.on(RULING, (data: unknown) => {
			(data as { ruling?: CallRuling }).ruling = spec.ruling;
		});
		// Pi runs the resolvers in load order, and the tool's own renderer comes last.
		const resolveAt = (index: number): ToolRenderers =>
			index < fake.toolRenderers.length
				? (fake.toolRenderers[index]!(spec.tool, () => resolveAt(index + 1)) ?? base)
				: base;

		const ui = {
			requestRender() {},
			terminal: { rows: 40, columns: width },
		} as unknown as TUI;
		// The clock lives in the state pi shares with the renderers, which is where the bash
		// renderer keeps its ticker too.
		let state: { interval?: unknown } = {};
		const chain = resolveAt(0);
		const watching: ToolRenderers = {
			...chain,
			// Pi draws the call before the result, and both see the same state object.
			renderCall: (args, theme, context) => {
				state = context.state as { interval?: unknown };
				const drawn = chain.renderCall?.(args, theme, context);
				if (drawn === undefined) throw new Error("the call has no renderer");
				return drawn;
			},
		};
		const call = new ToolExecutionComponent(
			spec.tool,
			"call-1",
			spec.args,
			{},
			watching,
			ui,
			"/repo",
		);
		// The frame times the whole call: the model writing it, then it running.
		call.render(width);
		behind = spec.wroteMs;
		if (spec.writing) return call.render(width);
		call.setArgsComplete();
		call.markExecutionStarted();
		if (spec.output === undefined) return call.render(width);

		const result = {
			content: [{ type: "text" as const, text: spec.output }],
			details: spec.details,
			isError: spec.error === true,
		};
		behind = spec.wroteMs + spec.ranMs;
		call.updateResult(result, spec.running === true);
		const lines = call.render(width);
		// A running call ticks, and the picture would never finish with the ticker alive.
		clearInterval(state.interval as never);
		return lines;
	} finally {
		Date.now = real;
	}
}

export function drawCalls(specs: readonly CallSpec[], width: number): string[] {
	return specs.flatMap((spec, index) => [...(index === 0 ? [] : [""]), ...drawCall(spec, width)]);
}
