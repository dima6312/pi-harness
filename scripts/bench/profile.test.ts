import { describe, expect, test } from "bun:test";

import { frameName, ours, type Profile, readProfile, report, under } from "./profile.ts";

/** root calls outer, which calls inner; root also waits idle. One sample of 1ms each. */
const JSON_PROFILE = JSON.stringify({
	startTime: 0,
	endTime: 4_000,
	nodes: [
		{ id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: 0 }, children: [2, 3] },
		{
			id: 2,
			callFrame: {
				functionName: "outer",
				url: "file:///repo/packages/look/src/a.ts",
				lineNumber: 1,
			},
			children: [4],
		},
		{
			id: 4,
			callFrame: {
				functionName: "inner",
				url: "file:///repo/packages/look/src/b.ts",
				lineNumber: 2,
			},
		},
		{ id: 3, callFrame: { functionName: "(idle)", url: "", lineNumber: 0 } },
	],
	samples: [4, 4, 3, 3],
	timeDeltas: [1000, 1000, 1000, 1000],
});

const profile = readProfile(JSON_PROFILE);

function node(id: number) {
	const found = profile.nodes.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`no node ${id}`);
	return found;
}

describe("reading a cpuprofile", () => {
	test("busy time leaves the idle samples out, and the window leaves the rest out", () => {
		const whole = report(profile, 0, 10);
		expect(whole.totalMs).toBe(4);
		expect(whole.busyMs).toBe(2);

		const half = report(profile, 0, 0.0025);
		expect(half.totalMs).toBe(2);
		expect(half.busyMs).toBe(2);
	});

	test("a frame counts once per sample on the way up, so inner adds to outer and root", () => {
		const frames = new Map(report(profile, 0, 10).inclusive.map((cost) => [cost.frame, cost.ms]));
		expect(frames.get(frameName(node(2)))).toBe(2);
		expect(frames.get(frameName(node(4)))).toBe(2);
		expect(frames.get(frameName(node(1)))).toBe(4);
		// The idle samples still reach the root.
		expect(frames.get(frameName(node(3)))).toBe(2);
	});

	test("the frames of this repository are the ones under packages/", () => {
		const mine = ours(report(profile, 0, 10).inclusive).map((cost) => cost.frame);
		expect(mine).toEqual([frameName(node(4)), frameName(node(2))]);
	});

	test("under a frame, its children hold the time, and self when the sample is the frame", () => {
		const children = under(profile, 0, 10, frameName(node(2)));
		expect(children).toEqual([{ frame: frameName(node(4)), ms: 2 }]);
		expect(under(profile, 0, 10, frameName(node(4)))).toEqual([{ frame: "(self)", ms: 2 }]);
	});

	test("an anonymous frame that belongs to no file still reads", () => {
		expect(frameName({ id: 9, callFrame: { functionName: "", url: "", lineNumber: 0 } })).toBe(
			"(anon) :0",
		);
	});

	test("a profile missing its parts reads as an empty one", () => {
		const empty: Profile = readProfile("{}");
		expect(report(empty, 0, 1)).toEqual({ busyMs: 0, totalMs: 0, inclusive: [] });
	});
});
