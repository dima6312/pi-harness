import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createEventBus, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { attributed } from "../src/app/attribution.ts";
import {
	createApp,
	defineContract,
	defineFeature,
	enabledSetting,
	type Feature,
	object,
	projectSettingsPath,
	setting,
	string,
} from "../src/index.ts";
import { listTabs } from "../src/screen/client.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

let dir: string;
let settingsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-kit-app-"));
	settingsPath = join(dir, "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function feature(id: string, setup: Feature["setup"] = () => {}): Feature {
	return defineFeature({ id, description: `the ${id} feature`, setup });
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data));
}

describe("mounting", () => {
	test("mounts every feature it was given", () => {
		const { pi } = fakePi();
		const app = createApp(pi, { name: "test", settingsPath })
			.use(feature("one"))
			.use(feature("two"))
			.build();
		expect(app.has("one")).toBe(true);
		expect(app.has("two")).toBe(true);
	});

	test("a feature that throws turns into a warning and the rest still mount", async () => {
		const { pi, fire } = fakePi();
		const app = createApp(pi, { name: "test", settingsPath })
			.use(
				feature("broken", () => {
					throw new Error("boom");
				}),
			)
			.use(feature("fine"))
			.build();
		expect(app.has("broken")).toBe(false);
		expect(app.has("fine")).toBe(true);

		const notes: string[] = [];
		await fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual(["test: broken: failed to set up: boom"]);
	});

	test("the same feature twice in one app keeps the first", () => {
		const { pi } = fakePi();
		let setups = 0;
		const counted = feature("counted", () => void setups++);
		const app = createApp(pi, { name: "test", settingsPath }).use(counted).use(counted).build();
		expect(app.has("counted")).toBe(true);
		expect(setups).toBe(1);
	});

	test("the factory only registers the two session handlers", () => {
		const { pi, count } = fakePi();
		createApp(pi, { name: "test", settingsPath }).use(feature("quiet")).build();
		expect(count("session_start")).toBe(1);
		expect(count("session_shutdown")).toBe(1);
	});
});

describe("turning a feature off", () => {
	test("a feature that is off is never set up", () => {
		writeJson(settingsPath, { features: { memory: { enabled: false } } });
		const { pi } = fakePi();
		let setups = 0;
		const app = createApp(pi, { name: "test", settingsPath })
			.use(feature("memory", () => void setups++))
			.build();
		expect(setups).toBe(0);
		expect(app.has("memory")).toBe(false);
	});

	test("its switch lives in the file and not on the settings screen", () => {
		const toggle = enabledSetting(feature("memory"));
		expect(toggle.id).toBe("features.memory.enabled");
		expect(toggle.default).toBe(true);
		expect(toggle.ui).toBeUndefined();
	});
});

describe("the feature scope", () => {
	test("a handler error carries the app, the feature and the event, and is rethrown", async () => {
		const { pi, fire } = fakePi();
		createApp(pi, { name: "pi-harness", settingsPath })
			.use(
				feature("permission", (scope) =>
					scope.on("tool_call", () => {
						throw new Error("boom");
					}),
				),
			)
			.build();

		await expect(fire("tool_call", {}, fakeContext())).rejects.toThrow(
			"pi-harness: permission: tool_call: boom",
		);
	});

	test("a handler's result comes through", async () => {
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(feature("gate", (scope) => scope.on("tool_call", () => ({ block: true, reason: "no" }))))
			.build();
		expect(await fire("tool_call", {}, fakeContext())).toEqual([{ block: true, reason: "no" }]);
	});

	test("attribution keeps a sync function sync and a rejection labeled", async () => {
		expect(attributed("label", () => 1)()).toBe(1);
		expect(() =>
			attributed("label", () => {
				throw new Error("sync");
			})(),
		).toThrow("label: sync");
		await expect(
			attributed("label", async () => Promise.reject(new Error("async")))(),
		).rejects.toThrow("label: async");
	});

	test("a command name another feature took is skipped with a warning", async () => {
		const registered: string[] = [];
		const { pi, fire } = fakePi();
		const withCommands = Object.assign(pi, {
			registerCommand: (name: string) => void registered.push(name),
		});
		createApp(withCommands, { name: "test", settingsPath })
			.use(feature("first", (scope) => scope.registerCommand("perm", { handler: async () => {} })))
			.use(feature("second", (scope) => scope.registerCommand("perm", { handler: async () => {} })))
			.build();

		expect(registered).toEqual(["harness", "perm"]);
		const notes: string[] = [];
		await fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual(["test: second: /perm is already registered by first; skipped"]);
	});

	test("a command handler error carries the command", async () => {
		let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
		const { pi } = fakePi();
		const withCommands = Object.assign(pi, {
			registerCommand: (_name: string, options: { handler: typeof handler }) => {
				handler = options.handler;
			},
		});
		createApp(withCommands, { name: "test", settingsPath })
			.use(
				feature("perm", (scope) =>
					scope.registerCommand("perm", {
						handler: async () => {
							throw new Error("nope");
						},
					}),
				),
			)
			.build();

		await expect(handler?.("", {} as ExtensionCommandContext)).rejects.toThrow(
			"test: perm: /perm: nope",
		);
	});
});

describe("two apps in one pi process", () => {
	test("the second copy of a feature stays off and says who has it", async () => {
		const bus = createEventBus();
		const harness = fakePi(bus);
		const standalone = fakePi(bus);
		let setups = 0;
		const shared = feature("subscription", () => void setups++);

		createApp(harness.pi, { name: "pi-harness", settingsPath }).use(shared).build();
		const copy = createApp(standalone.pi, { name: "pi-providers", settingsPath })
			.use(shared)
			.use(feature("hide"))
			.build();

		expect(setups).toBe(1);
		expect(copy.has("subscription")).toBe(false);
		expect(copy.has("hide")).toBe(true);

		const notes: string[] = [];
		await standalone.fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual([
			"pi-providers: subscription: already loaded by pi-harness, so this copy stays off",
		]);
	});

	test("a feature that is off in one app is free for another", () => {
		writeJson(settingsPath, { features: { hide: { enabled: false } } });
		const bus = createEventBus();
		const off = createApp(fakePi(bus).pi, { name: "off", settingsPath })
			.use(feature("hide"))
			.build();
		const other = join(dir, "other.json");
		const on = createApp(fakePi(bus).pi, { name: "on", settingsPath: other })
			.use(feature("hide"))
			.build();
		expect(off.has("hide")).toBe(false);
		expect(on.has("hide")).toBe(true);
	});

	test("an app that shut down gives its features up, as on a reload", async () => {
		const bus = createEventBus();
		const before = fakePi(bus);
		createApp(before.pi, { name: "old", settingsPath }).use(feature("subscription")).build();
		await before.fire("session_shutdown", { reason: "reload" }, fakeContext());

		const app = createApp(fakePi(bus).pi, { name: "new", settingsPath })
			.use(feature("subscription"))
			.build();
		expect(app.has("subscription")).toBe(true);
	});

	test("features share a contract: readers ask, the owner answers, and changes that do not decode are dropped", async () => {
		const bus = createEventBus();
		const inUse = defineContract<{ account: string }>(
			"accounts:in-use",
			object({ account: string }),
		);
		const heard: string[] = [];
		let asked: string | undefined;

		const listener = fakePi(bus);
		createApp(listener.pi, { name: "listener", settingsPath })
			.use(
				feature("statusline", (scope) => {
					inUse.onChanged(scope, (value) => heard.push(value?.account ?? "none"));
					asked = inUse.current(scope)?.account;
				}),
			)
			.build();
		expect(asked).toBeUndefined();

		createApp(fakePi(bus).pi, { name: "speaker", settingsPath })
			.use(
				feature("accounts", (scope) => {
					inUse.provide(scope, () => ({ account: "work" }));
					inUse.changed(scope, { account: "work" });
					inUse.changed(scope, undefined);
				}),
			)
			.build();
		bus.emit(`${inUse.channel}:changed`, { value: { account: 42 } });

		expect(heard).toEqual(["work", "none"]);
		const notes: string[] = [];
		await listener.fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual([
			"listener: statusline: ignored a change of accounts:in-use: accounts:in-use.account: expected a string",
		]);
	});
});

describe("the session lifecycle", () => {
	const preset = setting({
		id: "feature.preset",
		default: "default",
		decoder: string,
		project: true,
	});

	function presetApp(seen: string[]) {
		const fake = fakePi();
		createApp(fake.pi, { name: "test", settingsPath })
			.use(
				defineFeature({
					id: "feature",
					description: "reads the preset",
					settings: [preset],
					setup: (scope) => scope.onSessionStart(() => void seen.push(preset.get(scope))),
				}),
			)
			.build();
		return fake;
	}

	test("settings are loaded before any feature's session hook runs", async () => {
		const seen: string[] = [];
		const { fire } = presetApp(seen);
		writeJson(settingsPath, { feature: { preset: "from the file" } });
		await fire("session_start", {}, fakeContext());
		expect(seen).toEqual(["from the file"]);
	});

	test("the project file counts only in a trusted project", async () => {
		const cwd = join(dir, "repo");
		writeJson(projectSettingsPath(cwd), { feature: { preset: "from the project" } });
		const seen: string[] = [];
		const { fire } = presetApp(seen);

		await fire("session_start", {}, fakeContext([], true, { cwd, isProjectTrusted: () => false }));
		await fire("session_start", {}, fakeContext([], true, { cwd, isProjectTrusted: () => true }));
		expect(seen).toEqual(["default", "from the project"]);
	});

	test("a failing session hook warns with the feature's name and does not stop the others", async () => {
		const ran: string[] = [];
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(
				feature("first", (scope) =>
					scope.onSessionStart(() => {
						throw new Error("no network");
					}),
				),
			)
			.use(feature("second", (scope) => scope.onSessionStart(() => void ran.push("second"))))
			.build();

		const notes: string[] = [];
		await fire("session_start", {}, fakeContext(notes));
		expect(ran).toEqual(["second"]);
		expect(notes).toEqual(["test: first: failed to start the session: no network"]);
	});

	test("shutdown hooks run once per session, newest first", async () => {
		const order: string[] = [];
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(feature("watcher", (scope) => scope.onShutdown(() => void order.push("watcher"))))
			.use(feature("server", (scope) => scope.onShutdown(() => void order.push("server"))))
			.build();

		await fire("session_start", {}, fakeContext());
		await fire("session_shutdown", { reason: "quit" }, fakeContext());
		await fire("session_shutdown", { reason: "quit" }, fakeContext());
		expect(order).toEqual(["server", "watcher"]);

		await fire("session_start", {}, fakeContext());
		await fire("session_shutdown", { reason: "new" }, fakeContext());
		expect(order).toEqual(["server", "watcher", "server", "watcher"]);
	});

	test("without UI, warnings go to stderr", async () => {
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(feature("noisy", (scope) => scope.onSessionStart(() => scope.warn("something"))))
			.build();
		const printed: unknown[] = [];
		const original = console.error;
		console.error = (line: unknown) => void printed.push(line);
		try {
			await fire("session_start", {}, fakeContext([], false));
		} finally {
			console.error = original;
		}
		expect(printed).toEqual(["test: noisy: something"]);
	});
});

test("a tab can name its sections when it opens, and a value row can show a word in place of its value", async () => {
	const fake = fakePi();
	createApp(fake.pi, {
		name: "test",
		settingsPath: join(tmpdir(), `kit-sections-${process.pid}.json`),
	})
		.use(
			defineFeature({
				id: "live",
				description: "",
				sections: (ctx) => [ctx === undefined ? "none" : "Titled", "Other"],
				setup(scope) {
					scope.screen.value({
						id: "live.list",
						section: "Titled",
						label: "List",
						description: "",
						control: { type: "text", multiline: true },
						get: () => "a\nb",
						text: () => "2 items",
						set: () => undefined,
					});
				},
			}),
		)
		.build();
	await fake.fire("session_start", {}, fakeContext());
	const tab = listTabs(fake.pi.events).find((entry) => entry.title === "Live");
	expect(tab?.sections.slice(0, 2)).toEqual(["Titled", "Other"]);
	expect(tab?.rows.find((row) => row.id === "live.list")).toMatchObject({
		value: "a\nb",
		text: "2 items",
	});
});
