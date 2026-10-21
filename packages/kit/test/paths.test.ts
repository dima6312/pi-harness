import { describe, expect, test } from "bun:test";

import { expandHome, tildify } from "../src/paths.ts";

describe("the home folder as ~", () => {
	test("what you type expands, and only ~ and ~/ do", () => {
		expect(expandHome("~", "/home/ada")).toBe("/home/ada");
		expect(expandHome("~/src", "/home/ada")).toBe("/home/ada/src");
		expect(expandHome("~ada/src", "/home/ada")).toBe("~ada/src");
		expect(expandHome("src", "/home/ada")).toBe("src");
	});

	test("what is shown shortens under the home folder, and nowhere else", () => {
		expect(tildify("/home/ada", "/home/ada")).toBe("~");
		expect(tildify("/home/ada/src/", "/home/ada/")).toBe("~/src");
		expect(tildify("/home/adam/src", "/home/ada")).toBe("/home/adam/src");
		expect(tildify("/etc/hosts", "/home/ada")).toBe("/etc/hosts");
		expect(tildify("src/x", "/home/ada")).toBe("src/x");
		expect(tildify("/home/ada/x", "")).toBe("/home/ada/x");
	});
});
