import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isBuiltInTool, type ToolAdapter } from "#core/tools.ts";
import { NAME } from "#identity";
import { isRecord } from "#util/primitives.ts";

export const DECIDED_EVENT = `${NAME}:decided`;
export const TOOL_EVENT = `${NAME}:tool`;
export const ANSWER_ENTRY = `${NAME}:answer`;

export interface Decided {
	toolCallId: string;
	toolName: string;
	summary: string;
	action: "allow" | "block";
	/** The layer that decided, `you` for the dialog, or `no UI`. */
	by: string;
	reason?: string;
	note?: string;
}

export function announce(pi: ExtensionAPI, decided: Decided): void {
	pi.events.emit(DECIDED_EVENT, decided);
	if (decided.by === "you") pi.appendEntry(ANSWER_ENTRY, decided);
}

// Emit from session_start: every extension has loaded by then, so this one is listening.
export function listenForTools(
	scope: FeatureScope,
	tools: Map<string, Partial<ToolAdapter>>,
): void {
	scope.events.on(TOOL_EVENT, (data) => {
		if (!isRecord(data) || typeof data.name !== "string" || isBuiltInTool(data.name)) return;

		const adapter: Partial<ToolAdapter> = {};
		if (typeof data.edits === "boolean") adapter.edits = data.edits;
		if (typeof data.paths === "function") adapter.paths = data.paths as ToolAdapter["paths"];
		if (typeof data.describe === "function") {
			adapter.describe = data.describe as ToolAdapter["describe"];
		}
		if (typeof data.alwaysAsks === "function")
			adapter.alwaysAsks = data.alwaysAsks as ToolAdapter["alwaysAsks"];
		tools.set(data.name, adapter);
	});
}
