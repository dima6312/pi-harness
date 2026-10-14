import { describe, expect, test } from "bun:test";

import { callTarget, formatCost, formatTokens, mergeBetas } from "../src/index.ts";

describe("how a number reads", () => {
	test("a token count keeps its precision while it is small", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(506)).toBe("506");
		expect(formatTokens(4_500)).toBe("4.5k");
		expect(formatTokens(40_500)).toBe("41k");
		expect(formatTokens(4_400_000)).toBe("4.4M");
		expect(formatTokens(44_000_000)).toBe("44M");
	});

	test("a whole thousand loses its zero, and a negative never reads as a count", () => {
		expect(formatTokens(1_000)).toBe("1k");
		expect(formatTokens(10_000)).toBe("10k");
		expect(formatTokens(-5)).toBe("0");
	});

	test("a price shows cents under ten dollars, and none above", () => {
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(0.5)).toBe("$0.500");
		expect(formatCost(9.999)).toBe("$9.999");
		expect(formatCost(12.345)).toBe("$12.35");
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
