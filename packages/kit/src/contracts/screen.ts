import type { Theme } from "@earendil-works/pi-coding-agent";

// In the harness every piece is an extension of its own, so the screen asks them over pi.events.
// The bus is synchronous: an app answers by writing on the payload, like the claim.
import type { Control, Json } from "../control.ts";
import type { Layer } from "../settings/store.ts";

export const LIST = "harness:screen:list";
export const APPLY = "harness:screen:apply";
export const RUN = "harness:screen:run";
export const DONE = "harness:screen:done";
export const CHANGED = "harness:settings:changed";

export type RowKind = "setting" | "value" | "action" | "info";

export interface RowView {
	feature: string;
	id: string;
	kind: RowKind;
	section: string;
	label: string;
	description: string;
	control?: Control;
	value?: Json;
	text?: string;
	confirm?: string;
	/** How deep the row sits under its section. Each step indents two columns. */
	indent?: number;
	/** Where a value row applies, when that is not this session. */
	meta?: string;
	layer?: Layer;
	fallback?: Json;
	/** The global value a project value hides. */
	hidden?: Json;
	restart?: boolean;
	/** Lines that show what a value of the setting looks like, drawn under the list. */
	preview?: Preview;
}

/** Draws what a value of a setting looks like, in the screen's theme and width. */
export type Preview = (value: Json, theme: Theme, width: number) => string[];

export interface TabView {
	title: string;
	sections: string[];
	rows: RowView[];
}

export interface ListRequest {
	tabs: TabView[];
}

/** `unset` drops the value that wins, so the one below shows. */
export interface ApplyRequest {
	feature: string;
	id: string;
	op: "set" | "unset";
	value?: Json;
	answer?: { error?: string };
}

export interface RunRequest {
	feature: string;
	id: string;
	request: string;
	answer?: { error?: string };
}

export interface RunDone {
	request: string;
	text?: string;
	error?: string;
}

export interface Changed {
	/** The store that wrote, so it skips its own write. */
	source: string;
}
