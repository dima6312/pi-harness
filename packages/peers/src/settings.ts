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

export const ROOMS_SECTION = "Rooms";

/** What happens when an agent asks to bring the sessions of another folder into a room. */
export type LinkRule = "mode" | "ask" | "never";

export const link = setting<LinkRule>({
	id: "peers.link",
	default: "mode",
	decoder: literal("mode", "ask", "never"),
	ui: {
		section: ROOMS_SECTION,
		label: "When an agent asks for a room",
		description:
			"An agent can ask to talk to the sessions open in another folder. The permission mode decides it like any call: you answer the dialog, or the judge does by your policy. Always ask me brings the dialog in every mode, full included. Only me refuses, and the agent asks you to link it from Alt+R.",
		control: {
			type: "choice",
			options: [
				{ value: "mode", label: "the permission mode decides" },
				{ value: "ask", label: "always ask me" },
				{ value: "never", label: "only me" },
			],
		},
	},
});

export const PEERS_SETTINGS = [delivery, model, link];
