import { AUTO_MODEL, modelChoice, setting, string } from "@adeildo/pi-kit";

export const SETTINGS_SECTION = "Requests to everyone";

export const model = setting({
	id: "peers.model",
	default: AUTO_MODEL,
	decoder: string,
	ui: {
		section: SETTINGS_SECTION,
		label: "Model",
		description:
			"The model that bids for this session when you ask everyone. It reads what the session does, never the agent's conversation.",
		control: modelChoice,
	},
});

export const PEERS_SETTINGS = [model];
