import { questions } from "@adeildo/pi-ask-questions";
import { createApp, defineFeature } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PERMISSION_SETTINGS, readConfig, SECTIONS } from "#core/config/settings.ts";
import { listenForTools } from "#pi/api.ts";
import { registerBashTimer } from "#pi/bash-timer.ts";
import { registerShortcuts } from "#pi/commands.ts";
import { registerEvents } from "#pi/events.ts";
import { registerScreen } from "#pi/screen.ts";
import { createSession } from "#pi/session.ts";
import { registerJudgeEntry } from "#ui/judge-entry.ts";
import { registerNoteMessage } from "#ui/note-message.ts";
import { registerRulingLine } from "#ui/ruling-line.ts";

export const permission = defineFeature({
	id: "permission",
	description: "Ask before a tool call runs, with a judge model for the routine ones",
	sections: SECTIONS,
	settings: PERMISSION_SETTINGS,
	setup(scope) {
		registerBashTimer(scope);
		registerJudgeEntry(scope);
		registerNoteMessage(scope);

		const session = createSession();
		registerRulingLine(scope, session);
		registerEvents(scope, session);
		listenForTools(scope, session.customTools);
		registerShortcuts(scope, session);
		registerScreen(scope, session);

		// A change on the screen, or in another pi, applies to the next call.
		for (const entry of PERMISSION_SETTINGS) {
			entry.listen(scope, () => {
				session.config = readConfig(scope);
				session.judgeCache.clear();
			});
		}
	},
});

export default function piAskPermission(pi: ExtensionAPI): void {
	// The dialog is the questions feature's. It comes with the package, and the kit keeps it from
	// running twice when the questions package or the harness is installed as well.
	createApp(pi, { name: "pi-ask-permission" }).use(questions).use(permission).build();
}
