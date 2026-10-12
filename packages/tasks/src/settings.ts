import { AUTO_MODEL, boolean, modelChoice, setting, string } from "@adeildo/pi-kit";

export const SETTINGS_SECTION = "Settings";

export const model = setting({
	id: "tasks.model",
	default: AUTO_MODEL,
	decoder: string,
	ui: {
		section: SETTINGS_SECTION,
		label: "Model",
		description:
			"The model that keeps the tasks. It runs on your messages and when the agent stops. When it fails, the session's model answers.",
		control: modelChoice,
	},
});

export const nameSession = setting({
	id: "tasks.nameSession",
	default: true,
	decoder: boolean,
	ui: {
		section: SETTINGS_SECTION,
		label: "Name the session",
		description:
			"Names the session after its title, for /resume and the look. A name you give with /name stays.",
		control: { type: "toggle" },
	},
});

export const TASKS_SETTINGS = [model, nameSession];
