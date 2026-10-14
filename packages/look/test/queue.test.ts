import { afterEach, describe, expect, test } from "bun:test";

import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences } from "@earendil-works/pi-tui";

import { frameQueue, queueBlock } from "../src/ui/queue.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

function visible(component: Component, width: number): string[] {
	return component.render(width).map((line) => stripTerminalSequences(line));
}

describe("messages waiting to be sent", () => {
	afterEach(() => frameQueue(() => undefined));

	test("sit in a dashed frame, each with when it goes in and the key that edits them", () => {
		const block = queueBlock(
			{ steering: ["also run the docs check"], followUp: ["then push\nand tag it"] },
			"alt+up",
			plain,
		);
		expect(visible(block, 36)).toEqual([
			`\u256d\u2504 queued ${"\u2504".repeat(25)}\u256e`,
			"\u2506 steer  also run the docs check   \u2506",
			"\u2506 next   then push\u2026                \u2506",
			`\u2570\u2504 alt+up to edit ${"\u2504".repeat(17)}\u256f`,
		]);
	});

	test("replace pi's grey list, and leave it when the frames are off", () => {
		const children: Component[] = [];
		const host = {
			pendingMessagesContainer: {
				clear: () => children.splice(0),
				addChild: (child: Component) => children.push(child),
			},
			getAllQueuedMessages: () => ({ steering: ["go"], followUp: [] }),
			getAppKeyDisplay: () => "alt+up",
		};
		const update = (
			InteractiveMode.prototype as unknown as { updatePendingMessagesDisplay(): void }
		).updatePendingMessagesDisplay;
		frameQueue(() => plain);
		update.call(host);
		expect(children).toHaveLength(1);
		expect(visible(children[0]!, 30)[1]).toContain("steer  go");

		host.getAllQueuedMessages = () => ({ steering: [], followUp: [] });
		update.call(host);
		expect(children).toHaveLength(0);
	});
});
