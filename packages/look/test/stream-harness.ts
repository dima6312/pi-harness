// Drives pi's own tool component and pi's own write and edit renderers through the frame, in the
// order pi's interactive mode does it: the extensions hear each update first, then pi hands every
// call of the message its arguments again, and the end of the message completes them all.
import { createApp } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import {
	createEditToolDefinition,
	createWriteToolDefinition,
	type ExtensionContext,
	initTheme,
	ToolExecutionComponent,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { look } from "../src/index.ts";

export interface ScriptedCall {
	id: string;
	name: "write" | "edit";
	args: Record<string, unknown>;
}

interface Live {
	id: string;
	name: string;
	json: string;
	block: { type: "toolCall"; id: string; name: string; arguments: unknown };
	component?: ToolExecutionComponent;
}

export interface Harness {
	/** Streams a call's arguments in chunks, as the provider sends them, and ends it. */
	stream(call: ScriptedCall, chunk?: number, between?: () => void): void;
	/** Streams a call up to a part of its arguments, without ending it. */
	streamTo(call: ScriptedCall, upTo: number, chunk?: number): void;
	endMessage(): void;
	startExecution(id: string): void;
	/** A call pi rebuilds from the session: never streamed, never completed, with its result. */
	replay(call: ScriptedCall): void;
	render(id: string, width?: number): string[];
	/** The lines as they reach the terminal, colour codes and all. */
	raw(id: string, width?: number): string[];
	renders(id: string): number;
	/** How many times pi's own renderer drew the call. */
	asked(id: string): number;
	renderers(): ToolRenderers;
}

export function harness(cwd: string): Harness {
	initTheme("dark", false);
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	const ctx = {} as ExtensionContext;
	const live = new Map<string, Live>();
	const content: Live["block"][] = [];
	const counts = new Map<string, number>();
	const ui = { requestRender: () => {} };

	const asked = new Map<string, number>();
	const own = (definition: ToolRenderers): ToolRenderers => ({
		...definition,
		renderCall(args, theme, context) {
			asked.set(context.toolCallId, (asked.get(context.toolCallId) ?? 0) + 1);
			return definition.renderCall?.(args, theme, context) as never;
		},
	});
	const definitions: Record<string, ToolRenderers> = {
		write: own(createWriteToolDefinition(cwd) as ToolRenderers),
		edit: own(createEditToolDefinition(cwd) as ToolRenderers),
	};
	const resolve = (name: string) => {
		const at = (index: number): ToolRenderers | undefined =>
			index < fake.toolRenderers.length
				? fake.toolRenderers[index]!(name, () => at(index + 1))
				: definitions[name];
		return at(0);
	};
	const counted = (id: string, renderers: ToolRenderers): ToolRenderers => ({
		...renderers,
		renderCall(args, theme, context) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
			return renderers.renderCall?.(args, theme, context) as never;
		},
	});

	const build = (block: Live["block"]) =>
		new ToolExecutionComponent(
			block.name,
			block.id,
			block.arguments,
			{},
			counted(block.id, resolve(block.name) ?? {}) as never,
			ui as never,
			cwd,
		);

	const update = (type: string, toolCall?: Live["block"]) => {
		const message = { role: "assistant", content: [...content], usage: undefined };
		void fake.fire("message_update", { message, assistantMessageEvent: { type, toolCall } }, ctx);
		// Pi gives every call of the message its arguments again, the finished ones too.
		for (const block of content) {
			const known = live.get(block.id);
			if (known === undefined) continue;
			if (known.component === undefined) known.component = build(block);
			else known.component.updateArgs(block.arguments);
		}
	};

	const open = (call: ScriptedCall): Live => {
		let known = live.get(call.id);
		if (known === undefined) {
			const block = { type: "toolCall" as const, id: call.id, name: call.name, arguments: {} };
			known = { id: call.id, name: call.name, json: "", block };
			live.set(call.id, known);
			content.push(block);
			update("toolcall_start");
		}
		return known;
	};

	const feed = (known: Live, full: string, upTo: number, chunk: number, between?: () => void) => {
		while (known.json.length < upTo) {
			known.json = full.slice(0, Math.min(upTo, known.json.length + chunk));
			known.block.arguments = parseStreamingJson(known.json);
			update("toolcall_delta");
			between?.();
		}
	};

	return {
		stream(call, chunk = 7, between) {
			const known = open(call);
			const full = JSON.stringify(call.args);
			feed(known, full, full.length, chunk, between);
			// The provider finishes the block in place with the complete arguments.
			known.block.arguments = JSON.parse(full);
			update("toolcall_end", known.block);
		},
		streamTo(call, upTo, chunk = 7) {
			const known = open(call);
			const full = JSON.stringify(call.args);
			feed(known, full, Math.min(upTo, full.length), chunk);
		},
		endMessage() {
			const message = { role: "assistant", content: [...content] };
			void fake.fire("message_end", { message }, ctx);
			for (const known of live.values()) known.component?.setArgsComplete();
		},
		startExecution(id) {
			live.get(id)?.component?.markExecutionStarted();
		},
		replay(call) {
			const block = {
				type: "toolCall" as const,
				id: call.id,
				name: call.name,
				arguments: call.args,
			};
			const component = build(block);
			component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false } as never);
			live.set(call.id, { id: call.id, name: call.name, json: "", block, component });
		},
		render(id, width = 80) {
			return this.raw(id, width).map((line) => stripTerminalSequences(line).trimEnd());
		},
		raw(id, width = 80) {
			return live.get(id)?.component?.render(width) ?? [];
		},
		renders: (id) => counts.get(id) ?? 0,
		asked: (id) => asked.get(id) ?? 0,
		renderers: () => resolve("write") ?? {},
	};
}
