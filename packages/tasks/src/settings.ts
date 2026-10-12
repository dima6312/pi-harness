import { type Control, setting, string } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AUTO, modelRef, SESSION } from "./models.ts";

export const MODEL_SECTION = "Model";

export const model = setting({
	id: "tasks.model",
	default: AUTO,
	decoder: string,
	ui: {
		section: MODEL_SECTION,
		label: "Model",
		description:
			"The model that keeps the tasks. It runs on your messages and when the agent stops. When it fails, the session's model answers.",
		control: modelControl,
	},
});

export const TASKS_SETTINGS = [model];

function modelControl(ctx: ExtensionContext): Control {
	return {
		type: "choice",
		options: [
			{ value: AUTO, description: "the cheapest model of the session's provider" },
			{ value: SESSION, description: "the model you are talking to" },
			...ctx.modelRegistry.getAvailable().map((entry) => ({ value: modelRef(entry) })),
		],
	};
}
