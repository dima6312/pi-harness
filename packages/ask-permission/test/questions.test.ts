import { describe, expect, test } from "bun:test";

import { ANSWER, ASK, type AskRequest, type AskResult, AVAILABLE } from "@adeildo/pi-kit";
import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";

import type { FolderOffer } from "#core/answer.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { type Call, describeCall } from "#core/decide.ts";
import { askThroughQuestions } from "#ui/questions.ts";

/** Answers each ask with the next scripted result, and records what was asked. */
function provider(script: AskResult[]): { bus: EventBus; asked: AskRequest[] } {
	const bus = createEventBus();
	const asked: AskRequest[] = [];
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		asked.push(request);
		const result = script.shift() ?? { answers: [], cancelled: true };
		bus.emit(ANSWER, { id: request.id, result });
	});
	return { bus, asked };
}

function picked(option: string, notes: { option: string; note: string }[] = []): AskResult {
	return {
		answers: [{ question: "q", header: "permission", picked: [option], notes }],
		cancelled: false,
	};
}

function call(toolName = "bash", input: unknown = { command: "git push origin main" }): Call {
	return describeCall(toolName, input, "/repo", defaultConfig());
}

const OFFER: FolderOffer = {
	access: "read",
	folders: ["/other", "/other/nested"],
	suggested: 0,
	repoRoot: undefined,
} as unknown as FolderOffer;

describe("the first question", () => {
	test("a long command shows its first lines and how many are left", async () => {
		const { bus, asked } = provider([picked("no")]);
		const command = Array.from({ length: 30 }, (_, index) => `echo ${index}`).join("\n");
		await askThroughQuestions(bus, call("bash", { command }), {});

		const text = asked[0]!.questions[0]!.question;
		expect(text).toContain("echo 2");
		expect(text).not.toContain("echo 3");
		expect(text).toContain("... 27 more lines");
	});

	test("says what wants to run, and why it is asking", async () => {
		const { bus, asked } = provider([picked("no")]);
		await askThroughQuestions(bus, call(), { reason: "pushing is not in the policy", diff: "+x" });

		const [question] = asked[0]!.questions;
		expect(question?.header).toBe("permission");
		expect(question?.question).toContain("git push origin main");
		expect(question?.question).toContain("bash wants to run");
		expect(question?.question).toContain("\u25b2 pushing is not in the policy");
		expect(question?.options.map((option) => option.label)).toEqual(["yes", "always yes", "no"]);
		expect(question?.options.map((option) => option.preview)).toEqual(["+x", "+x", "+x"]);
	});

	test("an MCP call names the server and what it declares", async () => {
		const { bus, asked } = provider([picked("no")]);
		const mcp = describeCall(
			"mcp__sauron__delete_dashboard",
			{ dashboard: "1" },
			"/repo",
			defaultConfig(),
			{ facts: () => ({ namespace: { name: "sauron" }, annotations: { destructiveHint: true } }) },
		);
		await askThroughQuestions(bus, mcp, {});
		expect(asked[0]?.questions[0]?.question).toContain("sauron:delete_dashboard");
	});
});

describe("the answer", () => {
	test("yes allows, and keeps the note", async () => {
		const { bus } = provider([picked("yes", [{ option: "yes", note: "go ahead" }])]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({
			decision: "allow",
			note: "go ahead",
		});
	});

	test("no denies, and the note is the reason", async () => {
		const { bus } = provider([picked("no", [{ option: "no", note: "not now" }])]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({
			decision: "deny",
			note: "not now",
		});
	});

	test("a note on an option that was not picked is kept, and named", async () => {
		const { bus } = provider([picked("yes", [{ option: "no", note: "too risky" }])]);
		const answer = await askThroughQuestions(bus, call(), {});
		expect(answer?.note).toBe('on "no": too risky');
	});

	test("a typed answer denies, with what the user wants instead", async () => {
		const { bus } = provider([
			{
				answers: [
					{ question: "q", header: "permission", picked: [], typed: "use --dry-run", notes: [] },
				],
				cancelled: false,
			},
		]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({
			decision: "deny",
			note: "use --dry-run",
		});
	});

	test("closing the dialog denies", async () => {
		const { bus } = provider([{ answers: [], cancelled: true }]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({ decision: "deny" });
	});

	test("a provider that failed leaves the decision to the caller", async () => {
		const { bus } = provider([{ answers: [], cancelled: true, error: "boom" }]);
		expect(await askThroughQuestions(bus, call(), {})).toBeUndefined();
	});
});

describe("always yes", () => {
	test("asks which calls, then for how long, tightest first", async () => {
		const { bus, asked } = provider([
			picked("always yes"),
			picked("git push"),
			picked("this project"),
		]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({
			decision: "allow",
			remember: "git push",
			scope: "project",
		});
		expect(asked[1]?.questions[0]?.options.map((option) => option.label)).toEqual([
			"git push origin main",
			"git push",
			"git",
		]);
		expect(asked[1]?.questions[0]?.options[0]?.description).toBe("Only this exact call.");
		expect(asked[2]?.questions[0]?.options.map((option) => option.label)).toEqual([
			"this session",
			"this project",
			"everywhere",
		]);
	});

	test("closing the second question allows once, without remembering", async () => {
		const { bus } = provider([picked("always yes"), { answers: [], cancelled: true }]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({ decision: "allow" });
	});

	test("closing the third question keeps a session grant", async () => {
		const { bus } = provider([
			picked("always yes"),
			picked("git"),
			{ answers: [], cancelled: true },
		]);
		expect(await askThroughQuestions(bus, call(), {})).toEqual({
			decision: "allow",
			remember: "git",
			scope: "session",
		});
	});
});

describe("opening a folder", () => {
	test("the offer is an option, and it asks for how long", async () => {
		const { bus, asked } = provider([
			picked("yes, and allow reads in /other"),
			picked("this session"),
		]);
		const answer = await askThroughQuestions(bus, call("read", { path: "/other/a.ts" }), {
			offer: OFFER,
		});
		expect(answer).toEqual({
			decision: "allow",
			open: { path: "/other", access: "read", scope: "session" },
		});
		expect(asked[0]?.questions[0]?.options.map((option) => option.label)).toContain(
			"yes, and allow reads in /other",
		);
	});
});
