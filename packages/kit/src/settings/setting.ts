// A setting is declared next to the feature that reads it. The declaration is plain data plus two
// helpers, so one handle works against any app.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Preview } from "../contracts/screen.ts";
import type { Control } from "../control.ts";
import type { Decoder } from "../decode.ts";
import type { SettingsStore } from "./store.ts";

/** The setting's row on the settings screen. */
export interface SettingUi {
	section: string;
	label: string;
	description: string;
	/** Overrides the decoder's. A function runs each time the screen opens. */
	control?: Control | ((ctx: ExtensionContext) => Control);
	/** Applies only after `/reload`. */
	restart?: boolean;
	/** What a value looks like, drawn under the list while the setting or a value is selected. */
	preview?: Preview;
}

export interface SettingDefinition<T> {
	/** Dotted path in the settings file, like `subscription.claudeCodeVersion`. */
	id: string;
	default: T;
	decoder: Decoder<T>;
	/** Accept a value from the project's settings file, once pi trusts the project. */
	project?: boolean;
	ui?: SettingUi;
}

export interface SettingsScope {
	readonly settings: SettingsStore;
}

export interface Setting<T> extends SettingDefinition<T> {
	get(scope: SettingsScope): T;
	listen(scope: SettingsScope, listener: (value: T) => void): () => void;
}

export function setting<T>(definition: SettingDefinition<T>): Setting<T> {
	const handle: Setting<T> = {
		...definition,
		get: (scope) => scope.settings.get(handle),
		listen: (scope, listener) => scope.settings.listen(handle, listener),
	};
	return handle;
}

export function controlOf(
	entry: Setting<unknown>,
	ctx: ExtensionContext | undefined,
): Control | undefined {
	const declared = entry.ui?.control;
	if (typeof declared === "function")
		return ctx === undefined ? entry.decoder.control : declared(ctx);
	return declared ?? entry.decoder.control;
}
