// What decided a tool call, and why, drawn wherever the call is. The feature that knows the answer
// publishes it; whoever frames the call asks for it while drawing.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const RULING = "harness:calls:ruling";
export const RULING_CHANGED = "harness:calls:ruling-changed";
/** A feature that frames every call answers this, so the ruling is not drawn twice. */
export const FRAMED = "harness:calls:framed";

export const RULING_TONES = ["pending", "success", "warning", "error"] as const;

export type RulingTone = (typeof RULING_TONES)[number];

export interface CallRuling {
	tone: RulingTone;
	/** Who decided, like `judge approved` or `asking you`. */
	head: string;
	why?: string;
	/** What you wrote on your answer. */
	note?: string;
	/** Detail for an expanded call. */
	detail?: string;
	/** The call was blocked, so its result is only the reason the line already gives. */
	blocked?: boolean;
}

export interface RulingRequest {
	toolCallId: string;
	ruling?: CallRuling;
}

export interface RulingChange {
	toolCallId: string;
	ruling?: CallRuling;
}

type Events = ExtensionAPI["events"];

/** The ruling of a call, asked of every listener. Undefined when nothing decided it. */
export function rulingOf(events: Events, toolCallId: string): CallRuling | undefined {
	const request: RulingRequest = { toolCallId };
	events.emit(RULING, request);
	return request.ruling;
}

/** True when a feature draws each call in a frame of its own, which is where the ruling goes. */
export function callsFramed(events: Events): boolean {
	const probe = { framed: false };
	events.emit(FRAMED, probe);
	return probe.framed;
}

/** The fields of a call's arguments that name what it acted on, in the order they are worth trying. */
export const TARGET_FIELDS = ["path", "file_path", "command", "query", "url", "pattern"] as const;

/**
 * What the call pointed at: the path, the command, the query, cut to its first line. Empty when the
 * arguments name nothing, which is what a call about the session itself looks like.
 */
export function callTarget(args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	for (const field of TARGET_FIELDS) {
		const value = fields[field];
		if (typeof value === "string" && value.trim() !== "") return value.split("\n")[0] ?? "";
	}
	return "";
}
