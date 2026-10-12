import { AUTO_MODEL, boolean, integer, modelChoice, setting, string } from "@adeildo/pi-kit";

export const PRUNE_SECTION = "Old tool output";
export const SUMMARY_SECTION = "Compaction summary";

export const prune = setting({
	id: "compact.prune",
	default: true,
	decoder: boolean,
	ui: {
		section: PRUNE_SECTION,
		label: "Hide old tool output",
		description:
			"Replaces tool output older than the last 10 turns with a line that names its call. The agent's words, your words and errors stay.",
	},
});

export const pruneAbove = setting({
	id: "compact.pruneAbove",
	default: 150_000,
	decoder: integer(20_000, 2_000_000),
	ui: {
		section: PRUNE_SECTION,
		label: "Above",
		description:
			"Context size that starts a prune. Each prune rewrites the prompt cache once, so it waits until it can free at least two fifths of the context.",
		control: { type: "number", min: 20_000, max: 2_000_000, step: 10_000, unit: " tokens" },
	},
});

export const summary = setting({
	id: "compact.summary",
	default: true,
	decoder: boolean,
	ui: {
		section: SUMMARY_SECTION,
		label: "Write it from the tasks",
		description:
			"When pi compacts, the side model writes pi's summary, with the tasks and your last words on top as they are. Off, or without tasks, pi writes it on the session's model.",
	},
});

export const model = setting({
	id: "compact.model",
	default: AUTO_MODEL,
	decoder: string,
	ui: {
		section: SUMMARY_SECTION,
		label: "Model",
		description:
			"The model that writes pi's compaction summary. When it fails, the session's model writes it.",
		control: modelChoice,
	},
});

export const COMPACT_SETTINGS = [prune, pruneAbove, summary, model];
