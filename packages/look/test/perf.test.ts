// A redraw the person at the keyboard did not ask for must cost nothing. Typing redraws the screen,
// and a component that paints itself again on every one of those redraws is what makes typing lag.
import { describe, expect, test } from "bun:test";

import { createApp, RULING } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { look } from "../src/index.ts";
import { StripComponent } from "../src/ui/footer.ts";
import { screen, snapshot } from "./helpers.ts";

function frame(theme: Theme) {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	RULING.provide({ events: fake.pi.events, warn: () => {} }, () => ({
		tone: "success",
		head: "judge approved",
	}));

	const base: ToolRenderers = {
		renderCall: () => new Text("$ bun run test", 0, 0),
		renderResult: () => new Text("583 pass", 0, 0),
	};
	const resolveAt = (index: number): ToolRenderers | undefined =>
		index < fake.toolRenderers.length
			? fake.toolRenderers[index]!("bash", () => resolveAt(index + 1))
			: base;
	const chain = resolveAt(0);
	if (chain?.renderCall === undefined) throw new Error("no renderers");
	const component = chain.renderCall({ command: "bun run test" }, theme, {
		toolCallId: "call-1",
		invalidate: () => {},
		state: {},
		expanded: false,
		isPartial: false,
		isError: false,
		executionStarted: true,
		cwd: "/repo",
	} as never);
	return component;
}

describe("the cost of a redraw", () => {
	test("paints a call again only when something changed", () => {
		let painted = 0;
		const counting = {
			fg: (_color: string, text: string) => {
				painted++;
				return text;
			},
			bold: (text: string) => {
				painted++;
				return text;
			},
		} as unknown as Theme;

		const component = frame(counting);
		component.render(60);
		expect(painted).toBeGreaterThan(0);

		painted = 0;
		component.render(60);
		expect(painted).toBe(0);

		// A narrower screen is a new drawing.
		component.render(50);
		expect(painted).toBeGreaterThan(0);
	});

	test("redraws an unchanged call fast enough to type over", () => {
		const plain = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		} as unknown as Theme;
		const component = frame(plain);
		component.render(60);

		const started = performance.now();
		for (let index = 0; index < 200; index++) component.render(60);
		// The frame that repainted itself on every redraw took 0.27ms, forty times this.
		expect((performance.now() - started) / 200).toBeLessThan(0.1);
	});

	test("the strip keeps its drawing until something says the screen changed", () => {
		const data = snapshot();
		let reads = 0;
		const fixture = screen(data, {
			snapshot: () => {
				reads++;
				return data;
			},
		});
		const strip = new StripComponent(fixture);

		const first = strip.render(80);
		const readsOfTheFirstDrawing = reads;
		expect(strip.render(80)).toBe(first);
		expect(reads).toBe(readsOfTheFirstDrawing);

		// An event, a probe or a new branch is drawn when it happens, not on the next keystroke.
		fixture.bump();
		expect(strip.render(80)).not.toBe(first);
		expect(reads).toBeGreaterThan(readsOfTheFirstDrawing);

		const second = strip.render(80);
		strip.invalidate();
		expect(strip.render(80)).not.toBe(second);
	});
});
