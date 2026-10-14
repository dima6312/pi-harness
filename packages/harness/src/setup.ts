// The pi settings the harness changes, for `/harness setup`. `bun run pi:defaults` fails when pi
// moves a default one of them was chosen against.
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

type Value = string | number | boolean;

export interface PiSetting {
	key: string;
	value: Value;
	/** Pi's default when the value was chosen. */
	piDefault: Value;
	why: string;
	read(settings: SettingsManager): Value;
}

export const PI_SETTINGS: readonly PiSetting[] = [
	{
		key: "outputPad",
		value: 0,
		piDefault: 1,
		why: "the look frames the editor and draws the strip, so pi's extra row is empty space",
		read: (settings) => settings.getOutputPad(),
	},
	{
		key: "warnings.anthropicExtraUsage",
		value: false,
		piDefault: true,
		why: "the providers piece bills Anthropic to the Claude plan, so the extra usage warning is wrong",
		read: (settings) => settings.getWarnings().anthropicExtraUsage ?? true,
	},
	{
		key: "steeringMode",
		value: "all",
		piDefault: "one-at-a-time",
		why: "every message typed while the agent works reaches it at the next step",
		read: (settings) => settings.getSteeringMode(),
	},
	{
		key: "followUpMode",
		value: "all",
		piDefault: "one-at-a-time",
		why: "every follow-up queued while the agent works is sent together when it stops",
		read: (settings) => settings.getFollowUpMode(),
	},
	{
		key: "showCacheMissNotices",
		value: true,
		piDefault: false,
		why: "a cache miss is money, and the look already shows how much of the prompt was cached",
		read: (settings) => settings.getShowCacheMissNotices(),
	},
	{
		key: "cacheWarming",
		value: "idle",
		piDefault: "streaming",
		why: "a third of the cache misses came after a pause of 5 to 30 minutes, and the providers piece decides when a refresh between runs pays",
		read: (settings) => settings.getCacheWarmingMode(),
	},
];
