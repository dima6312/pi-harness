// The Alt+S screen, drawn by the real ScreenView with the look package's own settings, so the picture
// of the settings is the screen the product opens and not a mockup. Adapted from a scene by
// cache-warming.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus, type Theme } from "@earendil-works/pi-coding-agent";

import { createApp } from "../../packages/kit/src/index.ts";
import { listTabs } from "../../packages/kit/src/screen/client.ts";
import { ScreenModel } from "../../packages/kit/src/screen/model.ts";
import { ScreenView } from "../../packages/kit/src/screen/view.ts";
import { fakeContext, fakePi } from "../../packages/kit/src/testing.ts";
import { look } from "../../packages/look/src/index.ts";

/** The Look tab with the editor frame selected: the list, and its preview drawn under it. */
export async function settingsLines(theme: Theme): Promise<string[]> {
	const dir = mkdtempSync(join(tmpdir(), "look-settings-"));
	try {
		const fake = fakePi(createEventBus());
		createApp(fake.pi, { name: "look", settingsPath: join(dir, "settings.json") })
			.use(look)
			.build();
		await fake.fire("session_start", {}, fakeContext([], true, { ui: { theme } } as never));
		const view = new ScreenView({
			tui: { terminal: { rows: 26 }, requestRender() {} } as never,
			theme,
			events: fake.pi.events,
			model: new ScreenModel(listTabs(fake.pi.events)),
			done() {},
		});
		view.render(100);
		view.handleInput("\u001b[B");
		return view.render(100);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
