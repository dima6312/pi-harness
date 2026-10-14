// Fakes for testing features without a running pi. Two fakes on one bus behave like two extensions
// in the same pi process.
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createEventBus,
	createSyntheticSourceInfo,
	type EntryRenderer,
	type MessageRenderer,
	type EventBus,
	type ExtensionAPI,
	type ExtensionContext,
	type RegisteredCommand,
	type ToolDefinition,
	type ToolInfo,
	type ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";

import type { FeatureScope, ScreenEntry, ScreenGroup } from "./app/feature.ts";
import { SettingsStore } from "./settings/store.ts";

/** A tool as `getAllTools` reports it, with the fields the callers read. */
export function toolInfo(name: string, extra: Partial<ToolInfo> = {}): ToolInfo {
	return {
		name,
		description: "",
		parameters: { type: "object" } as ToolInfo["parameters"],
		exposure: "direct",
		sourceInfo: createSyntheticSourceInfo(`<test:${name}>`, { source: "test" }),
		...extra,
	};
}

export type FakeHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

export interface FakePi {
	pi: ExtensionAPI;
	handlers: Map<string, FakeHandler[]>;
	commands: Map<string, CommandOptions>;
	shortcuts: string[];
	tools: ToolDefinition[];
	/** Every registered tool, as `getAllTools` reports it. */
	allTools: ToolInfo[];
	providers: { name: string; config: unknown }[];
	renderers: Map<string, EntryRenderer>;
	messageRenderers: Map<string, MessageRenderer>;
	toolRenderers: ToolRendererResolver[];
	entries: { customType: string; data: unknown }[];
	messages: unknown[];
	/** What the extension sent as if you typed it. */
	userMessages: unknown[];
	sessionName: string | undefined;
	/** Runs every handler registered for `name`, in order, and returns what each returned. */
	fire(name: string, event: unknown, ctx: ExtensionContext): Promise<unknown[]>;
	count(name: string): number;
}

export function fakePi(bus: EventBus = createEventBus()): FakePi {
	const handlers = new Map<string, FakeHandler[]>();
	const commands = new Map<string, CommandOptions>();
	const fake: FakePi = {
		pi: undefined as unknown as ExtensionAPI,
		handlers,
		commands,
		shortcuts: [],
		tools: [],
		allTools: [],
		providers: [],
		renderers: new Map(),
		messageRenderers: new Map(),
		toolRenderers: [],
		entries: [],
		messages: [],
		userMessages: [],
		sessionName: undefined,
		async fire(name, event, ctx) {
			const results: unknown[] = [];
			for (const handler of handlers.get(name) ?? []) {
				// oxlint-disable-next-line no-await-in-loop -- pi runs handlers one at a time, in order
				results.push(await handler(event, ctx));
			}
			return results;
		},
		count: (name) => handlers.get(name)?.length ?? 0,
	};

	fake.pi = {
		on(name: string, handler: FakeHandler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		},
		events: bus,
		registerCommand: (name: string, options: CommandOptions) => void commands.set(name, options),
		registerShortcut: (shortcut: unknown) => void fake.shortcuts.push(String(shortcut)),
		registerTool: (tool: ToolDefinition) => void fake.tools.push(tool),
		getAllTools: () => fake.allTools,
		getCommands: () => [],
		registerProvider: (name: unknown, config?: unknown) =>
			void fake.providers.push({ name: String(name), config }),
		registerEntryRenderer: (customType: string, renderer: EntryRenderer) =>
			void fake.renderers.set(customType, renderer),
		registerMessageRenderer: (customType: string, renderer: MessageRenderer) =>
			void fake.messageRenderers.set(customType, renderer),
		registerToolRenderer: (resolver: ToolRendererResolver) =>
			void fake.toolRenderers.push(resolver),
		appendEntry: (customType: string, data?: unknown) =>
			void fake.entries.push({ customType, data }),
		sendMessage: (message: unknown) => void fake.messages.push(message),
		sendUserMessage: (content: unknown) => void fake.userMessages.push(content),
		setSessionName: (name: string) => void (fake.sessionName = name),
		getSessionName: () => fake.sessionName,
	} as unknown as ExtensionAPI;

	return fake;
}

export interface FakeScopeOptions {
	id?: string;
	pi?: FakePi;
	/** Collects what the feature warned about. */
	notes?: string[];
	settingsPath?: string;
	/** Collects the rows the feature adds to the settings screen. */
	screen?: ScreenEntry[];
	/** Collects the row providers, for the screen to run. */
	screenGroups?: ScreenGroup[];
}

/**
 * A feature scope over a fake pi, for calling a feature's own modules directly. Session hooks
 * registered through it run when `fire("session_start")` or `fire("session_shutdown")` is called.
 * It does not add the app's error attribution, which the kit tests on its own.
 */
export function fakeScope(options: FakeScopeOptions = {}): FeatureScope {
	const fake = options.pi ?? fakePi();
	const notes = options.notes ?? [];
	const rows = options.screen ?? [];
	const groups = options.screenGroups ?? [];
	const settings = new SettingsStore(
		options.settingsPath ?? join(tmpdir(), `pi-kit-scope-${process.pid}-${Math.random()}.json`),
	);

	return {
		...fake.pi,
		id: options.id ?? "test",
		settings,
		on: fake.pi.on,
		registerCommand: (name, command) => fake.pi.registerCommand(name, command),
		onSessionStart: (run) => void fake.pi.on("session_start", (_event, ctx) => run(ctx)),
		onShutdown: (run) => void fake.pi.on("session_shutdown", () => run()),
		warn: (message) => void notes.push(message),
		has: () => false,
		screen: {
			value: (row) => void rows.push({ kind: "value", ...row }),
			action: (row) => void rows.push({ kind: "action", ...row }),
			info: (row) => void rows.push({ kind: "info", ...row }),
			rows: (provider) => void groups.push(provider),
		},
	};
}

export function fakeContext(
	notes: string[] = [],
	hasUI = true,
	extra: Record<string, unknown> = {},
): ExtensionContext {
	return {
		hasUI,
		mode: hasUI ? "tui" : "print",
		cwd: "/nonexistent",
		isProjectTrusted: () => false,
		...extra,
		ui: {
			notify: (message: string) => notes.push(message),
			statuses: new Map<string, string | undefined>(),
			setStatus(key: string, text: string | undefined) {
				this.statuses.set(key, text);
			},
			onTerminalInput: () => () => {},
			...(extra.ui as Record<string, unknown> | undefined),
		},
	} as unknown as ExtensionContext;
}
