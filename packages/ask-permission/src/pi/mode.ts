import { GLYPH } from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { OutsideScope } from "#core/config/schema.ts";
import { policyWarning } from "#core/judge/policy.ts";
import { MODES, type PermissionMode } from "#core/mode.ts";
import { OUTSIDE_DESCRIPTION } from "#core/workspace.ts";
import { NAME } from "#identity";
import { record } from "#pi/session-entries.ts";
import type { SessionState } from "#pi/session.ts";

export const MODE_STATUS = `${NAME}:mode`;

const ARROW: Record<PermissionMode, string> = {
	manual: "",
	edits: `${GLYPH.play} `,
	judge: `${GLYPH.play} `,
	full: `${GLYPH.play}${GLYPH.play} `,
};

const OUTSIDE_TAG: Record<OutsideScope, string | undefined> = {
	ask: undefined,
	allow: "anywhere",
	deny: "workspace only",
};

export function setSessionMode(
	pi: ExtensionAPI,
	state: SessionState,
	mode: PermissionMode,
	ctx: ExtensionContext,
	announce = true,
): void {
	if (mode !== state.mode) record(pi, { kind: "mode", mode });
	state.mode = mode;
	renderStatus(ctx, state);

	if (!announce) return;
	ctx.ui.notify(`${NAME}: ${mode}, ${MODES[mode].description}`, "info");
	notifyJudgePolicyWarning(state, ctx);
}

export function setSessionOutside(
	pi: ExtensionAPI,
	state: SessionState,
	outside: OutsideScope,
	ctx: ExtensionContext,
	announce = true,
): void {
	if (outside !== state.outside) record(pi, { kind: "outside", outside });
	state.outside = outside;
	renderStatus(ctx, state);

	if (!announce) return;
	ctx.ui.notify(`${NAME}: outside ${outside}, ${OUTSIDE_DESCRIPTION[outside]}`, "info");
}

export function notifyJudgePolicyWarning(
	state: Pick<SessionState, "config" | "mode">,
	ctx: ExtensionContext,
): void {
	if (state.mode !== "judge") return;
	const warning = policyWarning(state.config.judge.policy);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

export function clearStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(MODE_STATUS, undefined);
}

export function renderStatus(
	ctx: ExtensionContext,
	state: Pick<SessionState, "mode" | "outside" | "folders">,
): void {
	const tag = OUTSIDE_TAG[state.outside];
	const folders = state.folders.total();
	const quiet = state.mode === "manual" && tag === undefined;
	if (quiet && folders === 0) {
		clearStatus(ctx);
		return;
	}
	if (!ctx.hasUI) return;

	const theme = ctx.ui.theme;
	const parts: string[] = [];
	if (!quiet) {
		const label = tag === undefined ? state.mode : `${state.mode} (${tag})`;
		const color = state.outside === "allow" ? "error" : "warning";
		parts.push(theme.fg(color, `${ARROW[state.mode]}${label}`));
	}
	// Open folders widen the workspace, so the status bar counts them.
	if (folders > 0)
		parts.push(theme.fg("dim", `+${folders} ${folders === 1 ? "folder" : "folders"}`));
	ctx.ui.setStatus(MODE_STATUS, parts.join("  "));
}
