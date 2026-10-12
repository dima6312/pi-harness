import { AUTO_MODEL, modelChoice, setting, string } from "@adeildo/pi-kit";

export const MODEL_SECTION = "Model";

export const model = setting({
	id: "tasks.model",
	default: AUTO_MODEL,
	decoder: string,
	ui: {
		section: MODEL_SECTION,
		label: "Model",
		description:
			"The model that keeps the tasks. It runs on your messages and when the agent stops. When it fails, the session's model answers.",
		control: modelChoice,
	},
});

export const TASKS_SETTINGS = [model];
