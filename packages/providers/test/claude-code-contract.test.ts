import { describe, expect, test } from "bun:test";

import { constant } from "../eval/claude-code/contract.ts";

describe("reading a header the registry spelled as a constant", () => {
	test("the name stands alone, so an HTML attribute ending in it does not count", () => {
		const source = `<link href="thumb.png">var c="x",ef="oauth-2025-04-20";REGISTRY`;
		expect(constant(source, "ef", source.indexOf("REGISTRY"))).toBe("oauth-2025-04-20");
	});

	test("a name the minifier reused takes the assignment nearest before the registry", () => {
		const source = `a="early-2024-01-01";b;a="oauth-2025-04-20";REGISTRY;a="late-2026-01-01"`;
		expect(constant(source, "a", source.indexOf("REGISTRY"))).toBe("oauth-2025-04-20");
	});

	test("one assigned only after the registry still resolves", () => {
		const source = `REGISTRY;a="oauth-2025-04-20"`;
		expect(constant(source, "a", 0)).toBe("oauth-2025-04-20");
	});
});
