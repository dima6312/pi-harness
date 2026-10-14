import { describe, expect, test } from "bun:test";

import { callTarget, formatClock, formatCost, formatTokens, mergeBetas } from "../src/index.ts";

describe("how a number reads", () => {
	test("a token count keeps its precision while it is small", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(506)).toBe("506");
		expect(formatTokens(4_500)).toBe("4.5k");
		expect(formatTokens(40_500)).toBe("41k");
		expect(formatTokens(4_400_000)).toBe("4.4M");
		expect(formatTokens(44_000_000)).toBe("44M");
	});

	test("a faixa vira na fronteira, sem depender do arredondamento de dentro dela", () => {
		expect(
			[999, 1000, 9999, 10_000, 999_999, 1_000_000, 9_999_999, 10_000_000].map(formatTokens),
		).toEqual(["999", "1k", "10k", "10k", "1000k", "1M", "10M", "10M"]);
		expect(formatTokens(-5)).toBe("0");
	});

	test("a price shows cents under ten dollars, and none from ten up", () => {
		expect([0, 0.0004, 0.5, 9.9999, 10, 12.345].map(formatCost)).toEqual([
			"$0.00",
			"$0.000",
			"$0.500",
			"$10.000",
			"$10.00",
			"$12.35",
		]);
	});
});

describe("the time of day", () => {
	test("reads as hours and minutes, with a leading zero", () => {
		expect(formatClock(new Date(2026, 8, 29, 9, 5).getTime())).toBe("09:05");
		expect(formatClock(new Date(2026, 8, 29, 23, 59).getTime())).toBe("23:59");
	});
});

describe("what a call pointed at", () => {
	test("takes the first field that names something, on its first line", () => {
		expect(callTarget({ command: "ls\nmore" })).toBe("ls");
		expect(callTarget({ file_path: "src/view.ts" })).toBe("src/view.ts");
		expect(callTarget({ path: "  ", query: "oauth" })).toBe("oauth");
	});

	test("an empty field is no answer, and arguments that name nothing give nothing", () => {
		expect(callTarget({})).toBe("");
		expect(callTarget({ content: "text" })).toBe("");
		expect(callTarget(undefined)).toBe("");
		expect(callTarget(["a"])).toBe("");
	});
});

describe("the betas a request carries", () => {
	test("keeps what pi computed, adds ours once, and drops what is not a name", () => {
		const first = mergeBetas(["pi-beta", 42], ["ours"]);
		expect(first.betas).toEqual(["pi-beta", "ours"]);
		expect(first.added).toBe(true);

		const again = mergeBetas(first.betas, ["ours"]);
		expect(again.added).toBe(false);
	});

	test("a payload with no list yet, or a list that is not one, still gets ours", () => {
		expect(mergeBetas(undefined, ["ours"]).betas).toEqual(["ours"]);
		expect(mergeBetas("nope", ["ours"]).betas).toEqual(["ours"]);
	});
});
