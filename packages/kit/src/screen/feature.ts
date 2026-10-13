// Every app brings this feature, and the claim keeps the first copy.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import type { Feature, FeatureScope } from "../app/feature.ts";
import { formatValue } from "../control.ts";
import { hideImagesUnderOverlays } from "../overlay-images.ts";
import { applyRow, listTabs } from "./client.ts";
import { ScreenModel } from "./model.ts";
import { type ScreenResult, ScreenView } from "./view.ts";

export const settingsScreen: Feature = {
	id: "settings-screen",
	description: "One screen for every setting of the harness",
	setup(scope) {
		scope.registerCommand("harness", {
			description: "Settings for every harness piece (also Alt+S)",
			getArgumentCompletions: (prefix) => {
				const typed = prefix.trim().toLowerCase();
				const tabs = listTabs(scope.events).map((tab) => tab.title.toLowerCase());
				const matches = tabs.filter((tab) => tab.startsWith(typed));
				return matches.length === 0 ? null : matches.map((tab) => ({ value: tab, label: tab }));
			},
			handler: (args, ctx) => openScreen(scope, ctx, args),
		});
		scope.registerShortcut(Key.alt("s"), {
			description: "Settings for every harness piece",
			handler: (ctx) => openScreen(scope, ctx, ""),
		});
	},
};

async function openScreen(scope: FeatureScope, ctx: ExtensionContext, tab: string): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("the settings screen needs the interactive terminal", "warning");
		return;
	}
	const model = new ScreenModel(listTabs(scope.events));
	if (tab.trim() !== "") model.openTab(tab);

	// The editor for long text is pi's own, so the screen closes for it and opens where it was.
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- one screen at a time
		const result = await ctx.ui.custom<ScreenResult>(
			(tui, theme, _keybindings, done) => {
				hideImagesUnderOverlays(tui);
				return new ScreenView({ tui, theme, events: scope.events, model, done });
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" } },
		);
		if (result?.kind !== "edit") return;

		const row = result.row;
		const current = typeof row.value === "string" ? row.value : "";
		// oxlint-disable-next-line no-await-in-loop -- the screen waits for the editor
		const text = await ctx.ui.editor(row.label, current);
		if (text !== undefined && text !== current) {
			const error = applyRow(scope.events, row, "set", text);
			const shown = row.control === undefined ? "" : formatValue(row.control, text);
			ctx.ui.notify(error ?? `${row.label}: ${shown}`, error === undefined ? "info" : "error");
		}
		model.refresh(listTabs(scope.events));
	}
}
