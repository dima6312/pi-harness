// Draws a call's ruling inside the tool's own box, and keeps it in the session for a resume. A
// feature that frames the calls draws it instead, and this only answers when it is asked.
import {
	type CallRuling,
	callsFramed,
	type FeatureScope,
	RULING,
	RULING_CHANGED,
	type RulingRequest,
	type RulingTone,
	RULING_TONES,
	GLYPH,
} from "@adeildo/pi-kit";
import type { ExtensionContext, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";

import { NAME } from "#identity";
import type { SessionState } from "#pi/session.ts";
import { isRecord } from "#util/primitives.ts";

export const RULING_ENTRY = `${NAME}:ruling`;

const ARGS_PREVIEW = 100;

export function registerRulingLine(scope: FeatureScope, state: SessionState): void {
	scope.events.on(RULING, (data) => {
		if (isRecord(data) && typeof data.toolCallId === "string")
			(data as unknown as RulingRequest).ruling = state.rulings.get(data.toolCallId);
	});
	scope.registerToolRenderer((toolName, next) => {
		const base = next();
		if (base === undefined) return undefined;
		// A feature that frames the calls draws the line, and pi drops the whole chain when a
		// resolver answers nothing, so this hands the renderer back untouched.
		if (callsFramed(scope.events)) return base;
		return withRuling(toolName, base, state);
	});
}

/** The line of a call still being decided. */
export function showRuling(
	scope: FeatureScope,
	state: SessionState,
	toolCallId: string,
	ruling?: CallRuling,
): void {
	if (ruling === undefined) state.rulings.delete(toolCallId);
	else state.rulings.set(toolCallId, ruling);
	state.redraws.get(toolCallId)?.();
	scope.events.emit(RULING_CHANGED, { toolCallId, ruling });
}

/** The final line of a call, kept in the session. */
export function keepRuling(
	scope: FeatureScope,
	state: SessionState,
	toolCallId: string,
	ruling: CallRuling | undefined,
): void {
	showRuling(scope, state, toolCallId, ruling);
	if (ruling !== undefined) scope.appendEntry(RULING_ENTRY, { toolCallId, ...ruling });
}

export function restoreRulings(state: SessionState, ctx: ExtensionContext): void {
	state.rulings.clear();
	// A verdict still in flight belongs to the branch being left, not to this one.
	state.prejudged.clear();
	for (const entry of ctx.sessionManager.getBranch()) {
		const kept = keptRuling(entry);
		if (kept !== undefined) state.rulings.set(kept.toolCallId, kept.ruling);
	}
	for (const redraw of state.redraws.values()) redraw();
}

function keptRuling(entry: unknown): { toolCallId: string; ruling: CallRuling } | undefined {
	if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== RULING_ENTRY) return;
	const data = entry.data;
	if (!isRecord(data) || typeof data.toolCallId !== "string" || typeof data.head !== "string")
		return;
	return {
		toolCallId: data.toolCallId,
		ruling: {
			tone: RULING_TONES.find((tone) => tone === data.tone) ?? "pending",
			head: data.head,
			why: text(data.why),
			note: text(data.note),
			detail: text(data.detail),
		},
	};
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function withRuling(toolName: string, base: ToolRenderers, state: SessionState): ToolRenderers {
	// The base renderer reuses its last component, which sits inside the box returned here.
	const inner = new WeakMap<Component, Component>();

	return {
		...base,
		renderCall(args, theme, context) {
			state.redraws.set(context.toolCallId, context.invalidate);
			const last = context.lastComponent;
			const lastComponent = last === undefined ? undefined : (inner.get(last) ?? last);
			const call = base.renderCall
				? base.renderCall(args, theme, { ...context, lastComponent })
				: new Text(callText(toolName, args, theme, context.expanded), 0, 0);

			const ruling = state.rulings.get(context.toolCallId);
			if (ruling === undefined) return call;
			const box = new Container();
			box.addChild(call);
			box.addChild(new Text(rulingText(ruling, theme, context.expanded), 0, 0));
			inner.set(box, call);
			return box;
		},
	};
}

function colorOf(tone: RulingTone): "dim" | "success" | "warning" | "error" {
	return tone === "pending" ? "dim" : tone;
}

export function rulingText(ruling: CallRuling, theme: Theme, expanded: boolean): string {
	const color = colorOf(ruling.tone);
	let line = `${theme.fg(color, GLYPH.judge)} ${theme.fg(color, ruling.head)}`;
	if (ruling.note) line += ` ${theme.fg("accent", GLYPH.chevron)} ${ruling.note}`;
	if (ruling.why) line += `  ${theme.fg("muted", ruling.why)}`;
	if (expanded && ruling.detail) line += `\n  ${theme.fg("dim", ruling.detail)}`;
	return line;
}

// Pi's header for a tool without a renderer. Pi does not export it.
function callText(toolName: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = theme.fg("toolTitle", theme.bold(toolName));
	if (!isRecord(args) || Object.keys(args).length === 0) return header;
	const entries = Object.entries(args);
	if (expanded) {
		const lines = entries.map(([key, value]) => `  ${key}: ${stringify(value)}`);
		return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
	const preview = pairs.length > ARGS_PREVIEW ? `${pairs.slice(0, ARGS_PREVIEW - 3)}...` : pairs;
	return `${header} ${theme.fg("muted", preview)}`;
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
}
