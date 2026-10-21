// Colleagues' messages that wait for your next prompt, drawn when they arrive: the same frames as a
// delivery, and one line under them that says why the agent did not get them yet.
import { drawnByWidth, ENTRY_X } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Held, PeerDelivery } from "../inbox.ts";
import { QUIET_AFTER, STEERS_PER_RUN } from "../rules.ts";
import { deliveryBlock } from "./message.ts";

/** What the transcript keeps of a held delivery. */
export interface HeldDelivery extends PeerDelivery {
	why: Held;
}

export function heldBlock(held: HeldDelivery, theme: Theme): Component {
	const frames = deliveryBlock(held, theme);
	return drawnByWidth((width) => [
		...frames.render(width),
		...wrapTextWithAnsi(heldLine(held), Math.max(1, width - ENTRY_X)).map(
			(line) => `${" ".repeat(ENTRY_X)}${theme.fg("muted", line)}`,
		),
	]);
}

export function heldLine(held: HeldDelivery): string {
	const them = held.items.length === 1 ? "It waits" : "They wait";
	switch (held.why) {
		case "asleep":
			return `${them} for your first prompt in this session.`;
		case "quiet":
			return `${them} for your next prompt: the agents answered each other ${QUIET_AFTER} times in a row, so this did not wake the agent.`;
		case "full":
			return `${them} for your next prompt: this run already took ${STEERS_PER_RUN} messages from other agents.`;
	}
}
