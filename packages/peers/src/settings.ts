import { AUTO_MODEL, literal, modelChoice, setting, string } from "@adeildo/pi-kit";

import { BUSY_DELIVERIES, type BusyDelivery } from "./rules.ts";

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

export const delivery = setting<BusyDelivery>({
	id: "peers.delivery",
	default: "steered",
	decoder: literal(...BUSY_DELIVERIES),
	ui: {
		section: SETTINGS_SECTION,
		label: "While it runs",
		description:
			"How a colleague's message reaches your agent while its run is going. Between calls attaches it at the end of what it is doing now, the way your own steer does; after the run waits for the turn to end; the next prompt never interrupts. A message marked urgent always attaches between calls.",
		control: {
			type: "choice",
			options: [
				{ value: "steered", label: "between calls" },
				{ value: "after-run", label: "after its run" },
				{ value: "next-turn", label: "with your next prompt" },
			],
		},
	},
});

export const PEERS_SETTINGS = [delivery, model];
