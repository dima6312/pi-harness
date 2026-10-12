// The app builder. A package's extension is `createApp(pi, ...).use(feature).build()`, and the
// harness is the same call with every feature. The builder is where the rules from pi's extension
// docs live: registration only in the factory, session work from `session_start`, cleanup once per
// session, and a feature that fails to set up becomes a warning.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { CHANGED } from "../contracts/screen.ts";
import { boolean, isObject } from "../decode.ts";
import { settingsScreen } from "../screen/feature.ts";
import { globalSettingsPath, projectSettingsPath } from "../settings/files.ts";
import { type Setting, type SettingsScope, setting } from "../settings/setting.ts";
import { SettingsStore } from "../settings/store.ts";
import { describe } from "./attribution.ts";
import { answerClaims, ownerOf } from "./claim.ts";
import type { Feature } from "./feature.ts";
import { serveScreen } from "./host.ts";
import { type AppState, createScope, type Hook } from "./scope.ts";

export interface App extends SettingsScope {
	/** Shown in front of every warning, like `pi-harness` or `pi-providers`. */
	readonly name: string;
	readonly settings: SettingsStore;
	/** True when this app runs a feature with that id. */
	has(featureId: string): boolean;
}

export interface AppOptions {
	name: string;
	settingsPath?: string;
}

export interface AppBuilder {
	use(feature: Feature): AppBuilder;
	build(): App;
}

export function createApp(pi: ExtensionAPI, options: AppOptions): AppBuilder {
	const features: Feature[] = [];
	const builder: AppBuilder = {
		use(feature) {
			features.push(feature);
			return builder;
		},
		build: () => mount(pi, options, features),
	};
	return builder;
}

export function enabledSetting(feature: Feature): Setting<boolean> {
	return setting({
		id: `features.${feature.id}.enabled`,
		default: true,
		decoder: boolean,
	});
}

function mount(pi: ExtensionAPI, options: AppOptions, features: readonly Feature[]): App {
	const settings = new SettingsStore(options.settingsPath ?? globalSettingsPath());
	const mounted = new Set<string>();
	const queued: string[] = [];
	let session: ExtensionContext | undefined;
	let live = true;

	function deliver(line: string): void {
		if (session === undefined) queued.push(line);
		else if (session.hasUI) session.ui.notify(line, "warning");
		else console.error(line);
	}

	const state: AppState = {
		name: options.name,
		pi,
		settings,
		mounted,
		commands: new Map(),
		starts: [],
		shutdowns: [],
		screen: new Map(),
		screenGroups: new Map(),
		report: (source, message) => deliver(`${options.name}: ${source}: ${message}`),
	};
	const app: App = { name: options.name, settings, has: (id) => mounted.has(id) };
	const running: Feature[] = [];

	answerClaims(pi, options.name, mounted, () => live);
	serveScreen({
		pi,
		settings,
		features: () => running,
		screen: state.screen,
		screenGroups: state.screenGroups,
		session: () => session,
		isLive: () => live,
	});

	// Every app writes the same files, so a write by one is read again by the others.
	const store = crypto.randomUUID();
	settings.onWrite(() => pi.events.emit(CHANGED, { source: store }));
	pi.events.on(CHANGED, (data) => {
		if (!live || !isObject(data) || data.source === store) return;
		for (const line of settings.load(settings.projectPath)) state.report("settings", line);
	});

	// Registered first, so these run ahead of the features' own handlers.
	pi.on("session_start", async (_event, ctx) => {
		live = true;
		session = ctx;
		for (const line of queued.splice(0)) deliver(line);
		const project = ctx.isProjectTrusted() ? projectSettingsPath(ctx.cwd) : undefined;
		for (const line of settings.load(project)) state.report("settings", line);
		await runInOrder(
			state.starts,
			(run) => run(ctx),
			(source, error) => {
				state.report(source, `failed to start the session: ${describe(error)}`);
			},
		);
	});

	pi.on("session_shutdown", async () => {
		if (!live) return;
		live = false;
		await runInOrder(
			state.shutdowns.toReversed(),
			(run) => run(),
			(source, error) => {
				state.report(source, `failed to shut down: ${describe(error)}`);
			},
		);
		session = undefined;
	});

	// All the switches first, so one read of the file decides what is on.
	const candidates: { feature: Feature; enabled: Setting<boolean> }[] = [];
	for (const feature of [settingsScreen, ...features]) {
		if (candidates.some((candidate) => candidate.feature.id === feature.id)) {
			state.report(feature.id, "was added to this app twice; keeping the first");
			continue;
		}
		const enabled = enabledSetting(feature);
		try {
			settings.register([enabled, ...(feature.settings ?? [])]);
			candidates.push({ feature, enabled });
		} catch (error) {
			state.report(feature.id, `failed to set up: ${describe(error)}`);
		}
	}

	for (const { feature, enabled } of candidates) {
		if (!enabled.get(app)) continue;

		const owner = ownerOf(pi, feature.id);
		if (owner !== undefined) {
			// Every app brings the screen, and one is enough.
			if (feature !== settingsScreen)
				state.report(feature.id, `already loaded by ${owner}, so this copy stays off`);
			continue;
		}

		try {
			feature.setup(createScope(state, feature.id));
			mounted.add(feature.id);
			running.push(feature);
		} catch (error) {
			state.report(feature.id, `failed to set up: ${describe(error)}`);
		}
	}

	return app;
}

async function runInOrder<T>(
	hooks: readonly Hook<T>[],
	call: (run: T) => void | Promise<void>,
	failed: (source: string, error: unknown) => void,
): Promise<void> {
	for (const hook of hooks) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- the order is the point
			await call(hook.run);
		} catch (error) {
			failed(hook.source, error);
		}
	}
}
