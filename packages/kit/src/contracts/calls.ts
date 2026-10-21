// What decided a tool call, and why, drawn wherever the call is. The feature that knows the answer
// publishes it; whoever frames the call asks for it while drawing.
import { defineContract } from "../contract.ts";
import { boolean, guarded, isObject } from "../decode.ts";

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

/** The ruling of a call, keyed by the tool call id. Nobody answers for a call nothing decided. */
export const RULING = defineContract<CallRuling, string>(
	"calls:ruling",
	guarded(isRuling, "a ruling with a tone and a head"),
);

/** A feature that frames every call answers true, so the ruling is not drawn twice. */
export const CALLS_FRAMED = defineContract<boolean>("calls:framed", boolean);

function isRuling(value: unknown): value is CallRuling {
	return (
		isObject(value) &&
		typeof value.head === "string" &&
		RULING_TONES.some((tone) => tone === value.tone)
	);
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
