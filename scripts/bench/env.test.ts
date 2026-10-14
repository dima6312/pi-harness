import { describe, expect, test } from "bun:test";

import { benchEnv } from "./env.ts";

describe("the environment the bench runs pi in", () => {
	test("the event log is the bench's own, so it never shows up in the room", () => {
		const env = benchEnv(
			{ PATH: "/bin", PI_HARNESS_EVENTS: "/home/ada/harness/events" },
			"/tmp/bench",
		);
		expect(env["PI_HARNESS_EVENTS"]).toBe("/tmp/bench/events");
		expect(env["PATH"]).toBe("/bin");
		expect(env["TERM"]).toBe("xterm-256color");
	});

	test("the profiler lands in the bench's directory, and NODE_OPTIONS already set is kept", () => {
		expect(benchEnv({}, "/tmp/bench")["NODE_OPTIONS"]).toBe("--cpu-prof --cpu-prof-dir=/tmp/bench");
		expect(
			benchEnv({ NODE_OPTIONS: "--max-old-space-size=4096" }, "/tmp/bench")["NODE_OPTIONS"],
		).toBe("--max-old-space-size=4096 --cpu-prof --cpu-prof-dir=/tmp/bench");
	});
});
