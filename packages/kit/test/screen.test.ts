import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createEventBus, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import {
	boolean,
	createApp,
	defineFeature,
	duration,
	type Feature,
	formatValue,
	integer,
	literal,
	nullable,
	type RowView,
	setting,
	SettingsStore,
	stringList,
	type TabView,
	withDefault,
} from "../src/index.ts";
import { applyRow, listTabs, runRow } from "../src/screen/client.ts";
import { ScreenModel } from "../src/screen/model.ts";
import { type ScreenResult, ScreenView } from "../src/screen/view.ts";
import { fakePi } from "../src/testing.ts";

let dir: string;
let globalPath: string;
let projectPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-kit-screen-"));
	globalPath = join(dir, "global", "settings.json");
	projectPath = join(dir, "project", "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data));
}

function read(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

const frame = setting({
	id: "look.frame",
	default: "rounded",
	decoder: literal("rounded", "square"),
	project: true,
	ui: { section: "Editor", label: "Frame", description: "The box around the editor." },
});
const gauge = setting({
	id: "look.gauge",
	default: 8,
	decoder: integer(0, 40),
	ui: { section: "Footer", label: "Gauge", description: "Cells in the gauge." },
});
const version = setting({
	id: "subscription.version",
	default: "2.1.0",
	decoder: literal("2.1.0", "2.2.0"),
	ui: { section: "Anthropic", label: "Version", description: "What pi reports." },
});

function ctx(): ExtensionContext {
	return {
		mode: "tui",
		hasUI: true,
		cwd: dir,
		isProjectTrusted: () => false,
		ui: { notify: () => {} },
	} as unknown as ExtensionContext;
}

describe("controls", () => {
	test("a decoder says how its value is edited", () => {
		expect(boolean.control).toEqual({ type: "toggle" });
		expect(literal("a", "b").control).toEqual({
			type: "choice",
			options: [{ value: "a" }, { value: "b" }],
		});
		expect(integer(0, 40).control).toEqual({ type: "number", min: 0, max: 40, step: 1 });
		expect(nullable(duration).control).toMatchObject({
			type: "number",
			unit: "ms",
			nullable: true,
		});
		expect(withDefault(stringList("paths"), []).control).toEqual({ type: "list" });
	});

	test("a value reads the way the control shows it", () => {
		expect(formatValue({ type: "toggle" }, true)).toBe("on");
		expect(formatValue({ type: "number", unit: "ms", nullable: true }, null)).toBe("none");
		expect(formatValue({ type: "number", unit: "ms" }, 500)).toBe("500ms");
		expect(formatValue({ type: "choice", options: [{ value: "jev", label: "Jev" }] }, "jev")).toBe(
			"Jev",
		);
		expect(formatValue({ type: "list" }, [])).toBe("(none)");
		const presets = [{ value: "a rule", label: "Standard" }];
		expect(formatValue({ type: "text", multiline: true, presets }, "a rule")).toBe("Standard");
		expect(formatValue({ type: "text", multiline: true, presets }, "mine")).toBe("custom");
		expect(formatValue({ type: "text" }, "one\ntwo")).toBe("one ...");
	});
});

describe("the store's layers", () => {
	test("a project value hides the global one, and dropping it shows the global again", () => {
		write(globalPath, { look: { frame: "square", gauge: 4 } });
		write(projectPath, { look: { frame: "rounded" } });
		const store = new SettingsStore(globalPath);
		store.register([frame, gauge]);
		store.load(projectPath);

		expect(store.layer(frame)).toBe("project");
		expect(store.hidden(frame)).toBe("square");
		expect(store.layer(gauge)).toBe("global");

		expect(store.unset(frame, "project")).toBeUndefined();
		expect(store.get(frame)).toBe("square");
		expect(read(projectPath)).toEqual({});

		expect(store.unset(gauge, "global")).toBeUndefined();
		expect(store.layer(gauge)).toBe("default");
		expect(read(globalPath)).toEqual({ look: { frame: "square" } });
	});

	test("a write tells whoever listens, so another store reads it again", () => {
		const store = new SettingsStore(globalPath);
		store.register([gauge]);
		let writes = 0;
		store.onWrite(() => writes++);
		store.set(gauge, 12);
		store.set(gauge, 12);
		expect(writes).toBe(1);
	});
});

function lookFeature(): Feature {
	return defineFeature({
		id: "look",
		description: "the look",
		sections: ["Footer", "Editor"],
		settings: [frame, gauge],
		setup(scope) {
			scope.screen.action({
				id: "explain",
				section: "Editor",
				label: "What is on screen",
				description: "Says what each piece is.",
				run: () => "a card and a frame",
			});
			scope.screen.action({
				id: "broken",
				section: "Editor",
				label: "Broken",
				description: "Fails.",
				run: () => {
					throw new Error("it broke");
				},
			});
		},
	});
}

function providersFeature(): Feature {
	let count = 0;
	return defineFeature({
		id: "subscription",
		description: "billing",
		tab: "Look",
		settings: [version],
		setup(scope) {
			scope.screen.value({
				id: "count",
				section: "Anthropic",
				label: "Count",
				description: "A value of this session.",
				control: { type: "number", min: 0 },
				get: () => count,
				set: (value) => {
					if (typeof value !== "number") return "not a number";
					count = value;
					return undefined;
				},
			});
			scope.screen.info({
				id: "plan",
				section: "Anthropic",
				label: "Plan",
				description: "What the account pays for.",
				indent: 1,
				text: () => "max",
			});
		},
	});
}

/** Rows built when the screen opens, over what only then exists. */
function dynamicFeature(): Feature {
	let policy = "ask";
	return defineFeature({
		id: "mcp",
		description: "servers",
		setup(scope) {
			scope.screen.rows(() => [
				{
					kind: "value",
					id: "server.filesystem",
					section: "Servers",
					label: "filesystem",
					description: "Connected.",
					meta: "saved for every project",
					control: { type: "choice", options: [{ value: "ask" }, { value: "allow" }] },
					get: () => policy,
					set: (value) => {
						if (typeof value !== "string") return "not a policy";
						policy = value;
						return undefined;
					},
				},
			]);
		},
	});
}

/** Two packages on one bus, the way the harness mounts them. */
async function twoApps() {
	const bus = createEventBus();
	const first = fakePi(bus);
	const second = fakePi(bus);
	createApp(first.pi, { name: "one", settingsPath: globalPath }).use(lookFeature()).build();
	const secondApp = createApp(second.pi, { name: "two", settingsPath: globalPath })
		.use(providersFeature())
		.build();
	await first.fire("session_start", {}, ctx());
	await second.fire("session_start", {}, ctx());
	return { first, second, secondApp, events: first.pi.events };
}

function rowOf(tabs: TabView[], id: string): RowView {
	const found = tabs.flatMap((tab) => tab.rows).find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`no row ${id}`);
	return found;
}

describe("the screen contract", () => {
	test("only the first app draws the screen, and it sees the rows of both", async () => {
		const { first, second, events } = await twoApps();
		expect(first.commands.has("harness")).toBe(true);
		expect(second.commands.has("harness")).toBe(false);

		const tabs = listTabs(events);
		expect(tabs.map((tab) => tab.title)).toEqual(["Look"]);
		expect(tabs[0]?.sections).toEqual(["Footer", "Editor", "Anthropic"]);
		expect(rowOf(tabs, "look.frame")).toMatchObject({
			kind: "setting",
			value: "rounded",
			layer: "default",
			control: { type: "choice" },
		});
		expect(rowOf(tabs, "plan")).toMatchObject({ kind: "info", text: "max" });
	});

	test("a change goes to the app that owns the row, through the setting's decoder", async () => {
		const { events, secondApp } = await twoApps();
		const tabs = listTabs(events);

		expect(applyRow(events, rowOf(tabs, "subscription.version"), "set", "9.9.9")).toContain(
			'expected "2.1.0" or "2.2.0"',
		);
		expect(applyRow(events, rowOf(tabs, "subscription.version"), "set", "2.2.0")).toBeUndefined();
		expect(version.get(secondApp)).toBe("2.2.0");
		expect(applyRow(events, rowOf(tabs, "count"), "set", 3)).toBeUndefined();
		expect(rowOf(listTabs(events), "count").value).toBe(3);
		expect(applyRow(events, rowOf(tabs, "count"), "set", "x")).toBe("not a number");
	});

	test("a write by one app is read again by the others", async () => {
		const bus = createEventBus();
		const reader = fakePi(bus);
		const writer = fakePi(bus);
		const readerApp = createApp(reader.pi, { name: "reader", settingsPath: globalPath })
			.use(defineFeature({ id: "a", description: "", settings: [gauge], setup() {} }))
			.build();
		const shared = setting({ ...gauge, id: "look.gauge" });
		const writerApp = createApp(writer.pi, { name: "writer", settingsPath: globalPath })
			.use(defineFeature({ id: "b", description: "", settings: [shared], setup() {} }))
			.build();
		await reader.fire("session_start", {}, ctx());
		await writer.fire("session_start", {}, ctx());

		expect(gauge.get(readerApp)).toBe(8);
		writerApp.settings.set(shared, 20);
		expect(gauge.get(readerApp)).toBe(20);
	});

	test("an action's text comes back, and a throw comes back as an error", async () => {
		const { events } = await twoApps();
		const tabs = listTabs(events);
		expect(await runRow(events, rowOf(tabs, "explain"))).toEqual({ text: "a card and a frame" });
		expect(await runRow(events, rowOf(tabs, "broken"))).toEqual({ error: "it broke" });
	});

	test("rows built when the screen opens are listed, and a change to them lands", async () => {
		const bus = createEventBus();
		const pi = fakePi(bus);
		createApp(pi.pi, { name: "one", settingsPath: globalPath }).use(dynamicFeature()).build();
		await pi.fire("session_start", {}, ctx());

		const tabs = listTabs(bus);
		expect(tabs[0]?.sections).toEqual(["Servers"]);
		expect(rowOf(tabs, "server.filesystem")).toMatchObject({
			kind: "value",
			value: "ask",
			meta: "saved for every project",
		});

		expect(applyRow(bus, rowOf(tabs, "server.filesystem"), "set", "allow")).toBeUndefined();
		expect(rowOf(listTabs(bus), "server.filesystem").value).toBe("allow");
		expect(applyRow(bus, rowOf(tabs, "server.filesystem"), "set", 3)).toBe("not a policy");
	});
});

function row(id: string, section: string, extra: Partial<RowView> = {}): RowView {
	return { feature: "f", id, kind: "setting", section, label: id, description: "", ...extra };
}

const TABS: TabView[] = [
	{
		title: "Permission",
		sections: ["Session", "Judge"],
		rows: [row("mode", "Session"), row("model", "Judge"), row("policy", "Judge")],
	},
	{ title: "Look", sections: ["Editor"], rows: [row("frame", "Editor"), row("cursor", "Editor")] },
];

describe("the screen model", () => {
	test("moves over rows, never headings, and stops at the edges", () => {
		const model = new ScreenModel(TABS);
		expect(model.selected()?.row.id).toBe("mode");
		model.move(1);
		expect(model.selected()?.row.id).toBe("model");
		model.move(10);
		expect(model.selected()?.row.id).toBe("policy");
		model.move(-10);
		expect(model.selected()?.row.id).toBe("mode");
	});

	test("jumps between sections and wraps around", () => {
		const model = new ScreenModel(TABS);
		model.jumpSection(1);
		expect(model.selected()?.row.id).toBe("model");
		model.jumpSection(1);
		expect(model.selected()?.row.id).toBe("mode");
		model.jumpSection(-1);
		expect(model.selected()?.row.id).toBe("model");
		expect(model.sections()).toEqual([
			{ title: "Session", active: false },
			{ title: "Judge", active: true },
		]);
	});

	test("a tab starts on its first row, and a refresh keeps the tab and the row", () => {
		const model = new ScreenModel(TABS);
		model.switchTab(1);
		model.move(1);
		expect(model.selected()?.row.id).toBe("cursor");
		model.refresh([...TABS]);
		expect(model.selected()?.row.id).toBe("cursor");
		model.switchTab(1);
		expect(model.selected()?.row.id).toBe("mode");
	});

	test("keeps the lines it built until the list, the tab or the query changes", () => {
		const model = new ScreenModel(TABS);
		const first = model.lines();
		expect(model.lines()).toBe(first);

		model.switchTab(1);
		const otherTab = model.lines();
		expect(otherTab).not.toBe(first);
		expect(model.lines()).toBe(otherTab);

		model.refresh([...TABS]);
		expect(model.lines()).not.toBe(otherTab);

		model.setQuery("o");
		const found = model.lines();
		expect(model.lines()).toBe(found);
		expect(found).not.toEqual(otherTab);
		expect(found.some((line) => line.kind === "heading")).toBe(true);
	});

	test("search spans every tab, groups by tab and section, and keeps the tabs' order", () => {
		const model = new ScreenModel(TABS);
		model.setQuery("o");
		const lines = model.lines().map((line) => (line.kind === "heading" ? line.title : line.row.id));
		expect(lines).toEqual([
			"Permission \u203a Session",
			"mode",
			"Permission \u203a Judge",
			"model",
			"policy",
			"Look \u203a Editor",
			"frame",
			"cursor",
		]);
		model.setQuery("polic");
		expect(model.selected()?.row.id).toBe("policy");
	});

	test("opens a tab by the start of its name", () => {
		const model = new ScreenModel(TABS);
		expect(model.openTab("lo")).toBe(true);
		expect(model.selected()?.row.id).toBe("frame");
		expect(model.openTab("nope")).toBe(false);
	});
});

const plain = (text: string): string => text;
const THEME = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: plain,
	underline: plain,
	inverse: plain,
} as unknown as Theme;

describe("the screen view", () => {
	async function view() {
		const { events } = await twoApps();
		const results: ScreenResult[] = [];
		const model = new ScreenModel(listTabs(events));
		const screen = new ScreenView({
			tui: { terminal: { rows: 30 }, requestRender: () => {} } as unknown as TUI,
			theme: THEME,
			events,
			model,
			done: (result) => results.push(result),
		});
		const text = () => screen.render(100).join("\n");
		return { screen, model, results, text, events };
	}

	test("fills the terminal, one line per row, each as wide as asked", async () => {
		const { screen } = await view();
		const lines = screen.render(100);
		expect(lines).toHaveLength(30);
		for (const line of lines) expect([...line].length).toBe(100);
	});

	test("only the section under the cursor stands out", async () => {
		const { events } = await twoApps();
		const model = new ScreenModel(listTabs(events));
		const screen = new ScreenView({
			tui: { terminal: { rows: 30 }, requestRender: () => {} } as unknown as TUI,
			theme: { ...THEME, fg: (color: string, text: string) => `<${color}>${text}` } as Theme,
			events,
			model,
			done: () => {},
		});
		const line = (text: string) => screen.render(100).find((entry) => entry.includes(text)) ?? "";

		expect(line("Footer")).toContain("<accent>Footer");
		expect(line("Gauge")).toContain("<accent>Gauge");
		expect(line("Editor")).toContain("<dim>Editor");
		expect(line("Frame")).toContain("<dim>Frame");

		model.jumpSection(1);
		expect(line("Editor")).toContain("<accent>Editor");
		expect(line("Footer")).toContain("<dim>Footer");
		expect(line("Gauge")).toContain("<dim>Gauge");
	});

	test("the rows sit under their heading", async () => {
		const { screen } = await view();
		// The rows, without the frame and the column of sections.
		const body = screen.render(100).map((entry) => entry.split("\u2502")[2]?.trimEnd() ?? "");
		const editor = body.findIndex((entry) => entry.trim() === "Editor");

		expect(body[editor]?.indexOf("Editor")).toBe(2);
		expect(body[editor + 1]?.indexOf("Frame")).toBe(4);
	});

	test("a choice's descriptions start on one column, and a long label stays whole", () => {
		const labels = ["short", "a/much/longer/label/that/passes/thirty-four"];
		const model = new ScreenModel([
			{
				title: "Look",
				sections: ["Editor"],
				rows: [
					{
						feature: "look",
						id: "pick",
						kind: "setting",
						section: "Editor",
						label: "Pick",
						description: "",
						control: {
							type: "choice",
							options: labels.map((value) => ({ value, description: "about it" })),
						},
						value: "short",
						layer: "default",
					},
				],
			},
		]);
		const screen = new ScreenView({
			tui: { terminal: { rows: 30 }, requestRender: () => {} } as unknown as TUI,
			theme: THEME,
			events: createEventBus(),
			model,
			done: () => {},
		});
		screen.handleInput("\r");
		const lines = screen.render(100);
		const rows = labels.map((label) => lines.find((line) => line.includes(label)) ?? "");

		expect(rows[1]).toContain(labels[1]);
		expect(rows[0]?.indexOf("about it")).toBe(rows[1]?.indexOf("about it"));
	});

	test("a row with an indent sits two columns deeper", async () => {
		const { screen } = await view();
		const lines = screen.render(100);
		const count = lines.find((line) => line.includes("Count"));
		const plan = lines.find((line) => line.includes("Plan"));
		if (count === undefined || plan === undefined) throw new Error("no rows");

		expect(plan.indexOf("Plan") - count.indexOf("Count")).toBe(2);
	});

	test("space moves a choice to its next value, and delete takes it back to the default", async () => {
		const { screen, model, text } = await view();
		model.moveToEdge("last");
		model.jumpSection(1);
		model.jumpSection(1);
		expect(model.selected()?.row.id).toBe("look.frame");

		screen.handleInput(" ");
		expect(model.selected()?.row).toMatchObject({ value: "square", layer: "global" });
		expect(text()).toContain("Frame: square");
		expect(read(globalPath)).toEqual({ look: { frame: "square" } });

		screen.handleInput("\u001b[3~");
		expect(model.selected()?.row).toMatchObject({ value: "rounded", layer: "default" });
		expect(text()).toContain("back to the default");
	});

	test("typing searches, escape clears the search, and a second escape closes", async () => {
		const { screen, model, results } = await view();
		for (const key of "gau") screen.handleInput(key);
		expect(model.query).toBe("gau");
		expect(model.selected()?.row.id).toBe("look.gauge");
		screen.handleInput("\u001b");
		expect(model.query).toBe("");
		expect(results).toEqual([]);
		screen.handleInput("\u001b");
		expect(results).toEqual([{ kind: "close" }]);
	});

	test("enter on a number opens an input that checks what is typed", async () => {
		const { screen, model, text } = await view();
		expect(model.selected()?.row.id).toBe("look.gauge");
		screen.handleInput("\r");
		expect(text()).toContain("Gauge, new value:");
		for (let index = 0; index < 4; index++) screen.handleInput("\u007f");
		for (const key of "99") screen.handleInput(key);
		screen.handleInput("\r");
		expect(text()).toContain("from 0 to 40");
		for (let index = 0; index < 2; index++) screen.handleInput("\u007f");
		for (const key of "12") screen.handleInput(key);
		screen.handleInput("\r");
		expect(model.selected()?.row.value).toBe(12);
	});
});

function preview(value: unknown): string[] {
	return [`looks like ${String(value)}`];
}

describe("a setting's preview", () => {
	const tabs: TabView[] = [
		{
			title: "Look",
			sections: ["Appearance"],
			rows: [
				row("style", "Appearance", {
					value: "rounded",
					control: {
						type: "choice",
						options: [
							{ value: "rounded", label: "rounded" },
							{ value: "square", label: "square" },
						],
					},
					preview,
				}),
				row("plain", "Appearance", { value: true }),
			],
		},
	];

	function open() {
		const model = new ScreenModel(tabs);
		const screen = new ScreenView({
			tui: { terminal: { rows: 30 }, requestRender: () => {} } as unknown as TUI,
			theme: THEME,
			events: { emit: () => {}, on: () => () => {} } as never,
			model,
			done: () => {},
		});
		return { screen, model, text: () => screen.render(100).join("\n") };
	}

	test("shows the current value under the list while the setting is selected", () => {
		const { model, text } = open();
		expect(text()).toContain("looks like rounded");
		model.move(1);
		expect(text()).not.toContain("looks like");
	});

	test("follows the highlighted value while picking", () => {
		const { screen, text } = open();
		screen.handleInput("\r");
		screen.handleInput("\u001b[B");
		expect(text()).toContain("looks like square");
	});
});
