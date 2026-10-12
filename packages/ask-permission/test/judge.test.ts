import { describe, expect, test } from "bun:test";

import type {
	ClassifierApi,
	ClassifierContext,
	ClassifierModel,
	ClassifierResult,
} from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, type PermissionConfig } from "#core/config/schema.ts";
import { createJudgeBackend, findClassifier, toAnswers } from "#core/judge/classifier.ts";
import { composeVerdict, judgeRisk, alwaysAskMatches, RISK_WEIGHTS } from "#core/judge/compose.ts";
import { defaultJudge, type JudgeConfig } from "#core/judge/config.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { judgeToolCall } from "#core/judge/pipeline.ts";
import {
	detectPolicyPreset,
	POLICY_PRESETS,
	POLICY_TEMPLATE,
	policyWarning,
} from "#core/judge/policy.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText, judgeSignalText, judgeVerdictText } from "#core/judge/report.ts";
import { buildJudgeQuestions, buildJudgeState } from "#core/judge/request.ts";
import {
	JudgeError,
	type JudgeAnswers,
	type JudgeAssessment,
	type JudgeBackend,
	type JudgeInput,
	type JudgeRecord,
} from "#core/judge/types.ts";

function answers(overrides: Partial<JudgeAnswers> = {}): JudgeAnswers {
	return {
		verdict: { choice: "allow", confidence: 0.95 },
		reversibility: 0.2,
		sensitive_access: 0.05,
		...overrides,
	};
}

function judgeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
	return {
		toolName: "bash",
		target: { summary: "pnpm test", levels: ["pnpm", "pnpm test"] },
		rawInput: { command: "pnpm test" },
		cwd: "/repo",
		policy: "allow tests",
		...overrides,
	};
}

function stubBackend(assessment: JudgeAssessment): JudgeBackend {
	return { assess: async () => assessment };
}

function classifier(provider: string, id: string): ClassifierModel<ClassifierApi> {
	return {
		type: "classifier",
		id,
		name: id,
		api: "typesafe-system-one",
		provider,
		baseUrl: "https://classifier.test/v1/",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64_000,
	};
}

const JEV = classifier("typesafe", "jev-latest");
const OPENROUTER_JEV = classifier("openrouter", "typesafe/jev-1.13");

type ClassifyOptions = { signal?: AbortSignal; maxRetryDelayMs?: number };

type Classify = (
	context: ClassifierContext,
	options: ClassifyOptions,
) => Promise<Partial<ClassifierResult>>;

function classifierResult(overrides: Partial<ClassifierResult> = {}): ClassifierResult {
	return {
		api: JEV.api,
		provider: JEV.provider,
		model: JEV.id,
		answers: {
			verdict: {
				type: "choice",
				choice: "allow",
				probabilities: { allow: 0.99, deny: 0, needs_human: 0.01 },
				confidence: 0.99,
			},
			reversibility: { type: "score", score: 0.1, confidence: 0.9 },
			sensitive_access: { type: "bool", probability: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
		...overrides,
	};
}

interface FakeRegistry {
	classify?: Classify;
	catalog?: ClassifierModel<ClassifierApi>[];
	keyed?: string[];
}

function fakeRegistry(options: FakeRegistry = {}): ModelRegistry {
	const catalog = options.catalog ?? [JEV];
	const keyed = new Set(options.keyed ?? catalog.map((model) => model.provider));
	const classify = options.classify ?? (async () => ({}));

	return {
		findOfType: (type: string, provider: string, id: string) =>
			type === "classifier"
				? catalog.find((model) => model.provider === provider && model.id === id)
				: undefined,
		getModelsOfType: (type: string) => (type === "classifier" ? catalog : []),
		getProviderAuthStatus: (provider: string) => ({ configured: keyed.has(provider) }),
		classify: async (
			model: ClassifierModel<ClassifierApi>,
			context: ClassifierContext,
			callOptions: ClassifyOptions,
		) => ({
			...classifierResult({ provider: model.provider, model: model.id }),
			...(await classify(context, callOptions)),
		}),
	} as unknown as ModelRegistry;
}

describe("composeVerdict", () => {
	test("approves a confident, low-risk call", () => {
		const result = composeVerdict(defaultJudge(), answers());
		expect(result.decision).toBe("allow");
		expect(result.risk).toBeCloseTo(
			RISK_WEIGHTS.reversibility * 0.1 + RISK_WEIGHTS.sensitive * 0.05,
			5,
		);
	});

	test("denies a confident denial", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "deny", confidence: 0.95 } }),
		);
		expect(result.decision).toBe("deny");
	});

	test("defers a timid denial", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "deny", confidence: 0.4 } }),
		);
		expect(result.decision).toBe("uncertain");
	});

	test("never auto-denies when canDeny is off", () => {
		const config = { ...defaultJudge(), canDeny: false };
		const result = composeVerdict(config, answers({ verdict: { choice: "deny", confidence: 1 } }));
		expect(result.decision).toBe("uncertain");
	});

	test("defers when risk is above the ceiling", () => {
		const config = { ...defaultJudge(), riskCeiling: 0.05 };
		expect(composeVerdict(config, answers()).decision).toBe("uncertain");
	});

	test("defers when a signal is missing", () => {
		const result = composeVerdict(defaultJudge(), answers({ reversibility: undefined }));
		expect(result.decision).toBe("uncertain");
		expect(result.risk).toBeUndefined();
	});

	test("a needs_human verdict always defers", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "needs_human", confidence: 1 } }),
		);
		expect(result.decision).toBe("uncertain");
	});
});

describe("judgeRisk", () => {
	test("weights each signal", () => {
		expect(judgeRisk({ reversibility: 2, sensitive_access: 1 })).toBeCloseTo(
			RISK_WEIGHTS.reversibility + RISK_WEIGHTS.sensitive,
			5,
		);
	});

	test("is undefined with a missing signal", () => {
		expect(judgeRisk({ reversibility: 2 })).toBeUndefined();
	});
});

describe("alwaysAskMatches", () => {
	test("matches the summary or any level", () => {
		const config = { ...defaultJudge(), alwaysAsk: ["rm -rf*"] };
		expect(alwaysAskMatches(config, ["rm -rf /", "rm"])).toBe(true);
		expect(alwaysAskMatches(config, ["pnpm test"])).toBe(false);
	});
});

describe("buildJudgeState", () => {
	test("carries policy, call, project root, and the request", () => {
		const state = buildJudgeState(judgeInput());
		expect(state.policy).toBe("allow tests");
		expect((state.call as Record<string, unknown>).tool).toBe("bash");
		expect((state.project as Record<string, unknown>).root).toBe("/repo");
	});

	test("sends only what a question refers to", () => {
		const state = buildJudgeState(judgeInput());
		expect(Object.keys(state.call as Record<string, unknown>)).toEqual(["tool", "input"]);
		expect(Object.keys(state.project as Record<string, unknown>)).toEqual(["root"]);
	});

	test("says where the call comes from when the tool name does not", () => {
		const state = buildJudgeState(
			judgeInput({ source: 'MCP server "sauron", which declares the tool reads' }),
		);
		expect((state.call as Record<string, unknown>).source).toBe(
			'MCP server "sauron", which declares the tool reads',
		);
	});

	test("carries the intent as context, and the description of a tool it cannot know", () => {
		const state = buildJudgeState(
			judgeInput({ intent: "  fix the flaky test  ", toolDescription: "Searches the memory" }),
		);
		expect(state.intent).toBe("fix the flaky test");
		expect((state.call as Record<string, unknown>).tool_says).toBe("Searches the memory");
		expect(Object.keys(buildJudgeState(judgeInput({ intent: " " })))).not.toContain("intent");
	});

	test("caps an oversized intent", () => {
		const state = buildJudgeState(judgeInput({ intent: "y".repeat(10_000) }));
		expect((state.intent as string).length).toBeLessThan(10_000);
	});

	test("caps an oversized input", () => {
		const state = buildJudgeState(judgeInput({ rawInput: "x".repeat(20_000) }));
		const input = (state.call as Record<string, unknown>).input as string;
		expect(input.length).toBeLessThan(20_000);
		expect(input.endsWith("...")).toBe(true);
	});
});

describe("findClassifier", () => {
	test("finds a classifier by provider and id, with slashes in the id", () => {
		const registry = fakeRegistry({ catalog: [JEV, OPENROUTER_JEV] });
		expect(findClassifier(registry, "typesafe/jev-latest")).toBe(JEV);
		expect(findClassifier(registry, " openrouter/typesafe/jev-1.13 ")).toBe(OPENROUTER_JEV);
		expect(findClassifier(registry, "anthropic/claude-haiku")).toBeUndefined();
	});

	test("a bare id, as older settings saved it, prefers a provider with a key", () => {
		const unkeyed = classifier("elsewhere", "jev-latest");
		const registry = fakeRegistry({ catalog: [unkeyed, JEV], keyed: ["typesafe"] });
		expect(findClassifier(registry, "jev-latest")).toBe(JEV);
		expect(findClassifier(fakeRegistry({ catalog: [unkeyed], keyed: [] }), "jev-latest")).toBe(
			unkeyed,
		);
		expect(findClassifier(registry, "claude-haiku")).toBeUndefined();
	});
});

describe("buildJudgeQuestions", () => {
	test("asks the fixed battery", () => {
		const questions = buildJudgeQuestions();
		expect(Object.keys(questions)).toEqual(["verdict", "reversibility", "sensitive_access"]);
	});

	test("uses pi's classifier question types, one string per instruction and label", () => {
		const questions = buildJudgeQuestions();
		expect(questions.verdict?.type).toBe("choice");
		expect(questions.reversibility?.type).toBe("score");
		expect(questions.sensitive_access?.type).toBe("bool");
		for (const question of Object.values(questions)) {
			expect(typeof question.instructions).toBe("string");
			const labels = Array.isArray(question.criteria)
				? question.criteria
				: Object.values(question.criteria);
			for (const label of labels) expect(typeof label).toBe("string");
		}
	});
});

describe("policy", () => {
	test("detects a preset and calls hand-written text custom", () => {
		const standard = POLICY_PRESETS.find((preset) => preset.id === "standard");
		expect(detectPolicyPreset(standard?.policy ?? "")).toBe("standard");
		expect(detectPolicyPreset("my own rules")).toBe("custom");
	});

	test("warns on an empty or oversized policy", () => {
		expect(policyWarning("")).toContain("no policy");
		expect(policyWarning("x".repeat(9000))).toContain("characters");
		expect(policyWarning(POLICY_TEMPLATE)).toBeUndefined();
	});
});

describe("toAnswers", () => {
	test("reads the typed answers", () => {
		const read = toAnswers(classifierResult().answers);
		expect(read.verdict).toEqual({ choice: "allow", confidence: 0.99 });
		expect(read.reversibility).toBe(0.1);
		expect(read.sensitive_access).toBe(0);
	});

	test("ignores an unknown choice and an answer of the wrong type", () => {
		const read = toAnswers({
			verdict: { type: "choice", choice: "maybe", probabilities: {}, confidence: 1 },
			reversibility: { type: "bool", probability: 1 },
		});
		expect(read.verdict).toBeUndefined();
		expect(read.reversibility).toBeUndefined();
		expect(read.sensitive_access).toBeUndefined();
	});
});

describe("createJudgeBackend", () => {
	function assess(registry: ModelRegistry, judge: Partial<JudgeConfig> = {}, signal?: AbortSignal) {
		const backend = createJudgeBackend({ ...defaultJudge(), timeoutMs: 1000, ...judge }, registry);
		return backend.assess(judgeInput(), signal ?? new AbortController().signal);
	}

	test("defaults to TypeSafe's Jev", () => {
		expect(defaultJudge().model).toBe("typesafe/jev-latest");
	});

	test("sends the state and the questions, and returns an assessment", async () => {
		let sent: ClassifierContext | undefined;
		const registry = fakeRegistry({
			classify: async (context) => {
				sent = context;
				return { usage: { input: 300, output: 12 } as ClassifierResult["usage"] };
			},
		});
		const assessment = await assess(registry);

		expect(Object.keys(sent?.questions ?? {})).toEqual([
			"verdict",
			"reversibility",
			"sensitive_access",
		]);
		expect(sent?.state.policy).toBe("allow tests");
		expect(assessment.model).toBe("typesafe/jev-latest");
		expect(assessment.answers.verdict?.choice).toBe("allow");
		expect(assessment.usage).toEqual({ input: 300, output: 12 });
	});

	test("rejects a model that is not a classifier pi knows", async () => {
		await expect(assess(fakeRegistry(), { model: "anthropic/claude-haiku" })).rejects.toMatchObject(
			{ code: "no-model" },
		);
	});

	test("caps how long pi waits on a retry at the timeout", async () => {
		let delay: number | undefined;
		const registry = fakeRegistry({
			classify: async (_context, options) => {
				delay = options.maxRetryDelayMs;
				return {};
			},
		});
		await assess(registry, { timeoutMs: 1234 });
		expect(delay).toBe(1234);
	});

	test("reports what pi says when the classifier fails", async () => {
		const registry = fakeRegistry({
			classify: async () => ({ stopReason: "error", errorMessage: "System One API returned 401" }),
		});
		await expect(assess(registry)).rejects.toMatchObject({
			code: "model-error",
			message: "System One API returned 401",
		});
	});

	test("times out", async () => {
		const registry = fakeRegistry({
			classify: (_context, options) =>
				new Promise((resolve) => {
					options.signal?.addEventListener("abort", () => resolve({ stopReason: "aborted" }));
				}),
		});
		await expect(assess(registry, { timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
	});

	test("propagates a caller abort", async () => {
		const controller = new AbortController();
		const registry = fakeRegistry({
			classify: async () => {
				controller.abort(new Error("cancelled by the user"));
				return { stopReason: "aborted" };
			},
		});
		await expect(assess(registry, {}, controller.signal)).rejects.toThrow("cancelled by the user");
	});
});

describe("judgeToolCall", () => {
	test("short-circuits a never rule without calling the backend", async () => {
		let called = false;
		const backend: JudgeBackend = {
			assess: async () => {
				called = true;
				return { model: "typesafe/jev-latest", answers: {}, elapsedMs: 0 };
			},
		};

		const config = { ...defaultJudge(), alwaysAsk: ["rm -rf*"] };
		const outcome = await judgeToolCall({
			config,
			backend,
			input: judgeInput({ target: { summary: "rm -rf /", levels: ["rm", "rm -rf /"] } }),
		});

		expect(called).toBe(false);
		expect(outcome.action).toBe("ask");
		expect(outcome.record).toBeDefined();
	});

	test("a pattern on the registered name still matches an MCP tool", async () => {
		const config = { ...defaultJudge(), alwaysAsk: ["mcp__*"] };
		const backend: JudgeBackend = {
			assess: async () => {
				throw new Error("the backend must not run");
			},
		};

		const outcome = await judgeToolCall({
			config,
			backend,
			input: judgeInput({
				toolName: "mcp__sauron__delete_dashboard",
				target: { summary: '{"id":12}', levels: ["sauron:delete_dashboard"] },
			}),
		});

		expect(outcome.action).toBe("ask");
		expect(outcome.reason).toBe("it matches judge.alwaysAsk");
	});

	test("allows, denies, and escalates by verdict", async () => {
		const allow = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({ model: "typesafe/jev-latest", answers: answers(), elapsedMs: 1 }),
			input: judgeInput(),
		});
		expect(allow.action).toBe("allow");

		const deny = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({
				model: "typesafe/jev-latest",
				answers: answers({ verdict: { choice: "deny", confidence: 0.99 } }),
				elapsedMs: 1,
			}),
			input: judgeInput(),
		});
		expect(deny.action).toBe("deny");

		const unsure = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({
				model: "typesafe/jev-latest",
				answers: answers({ verdict: { choice: "needs_human", confidence: 1 } }),
				elapsedMs: 1,
			}),
			input: judgeInput(),
		});
		expect(unsure.action).toBe("ask");
	});

	test("a dry run records the verdict but still asks", async () => {
		const config = { ...defaultJudge(), dryRun: true };
		const outcome = await judgeToolCall({
			config,
			backend: stubBackend({ model: "typesafe/jev-latest", answers: answers(), elapsedMs: 1 }),
			input: judgeInput(),
		});

		expect(outcome.action).toBe("ask");
		expect(outcome.record?.action).toBe("allow");
		expect(outcome.record?.dryRun).toBe(true);
	});

	test("uses onError when the backend fails", async () => {
		const backend: JudgeBackend = {
			assess: async () => {
				throw new JudgeError("boom", "network");
			},
		};

		const ask = await judgeToolCall({ config: defaultJudge(), backend, input: judgeInput() });
		expect(ask.action).toBe("ask");
		expect(ask.record?.error).toBe("network");

		const deny = await judgeToolCall({
			config: { ...defaultJudge(), whenItFails: "deny" },
			backend,
			input: judgeInput(),
		});
		expect(deny.action).toBe("deny");
	});

	test("a dry run never acts, even on error", async () => {
		const backend: JudgeBackend = {
			assess: async () => {
				throw new JudgeError("boom", "network");
			},
		};

		const outcome = await judgeToolCall({
			config: { ...defaultJudge(), dryRun: true, whenItFails: "deny" },
			backend,
			input: judgeInput(),
		});

		expect(outcome.action).toBe("ask");
		expect(outcome.record?.action).toBe("deny");
		expect(outcome.record?.dryRun).toBe(true);
	});

	test("honors onUncertain", async () => {
		const backend = stubBackend({
			model: "typesafe/jev-latest",
			answers: answers({ verdict: { choice: "needs_human", confidence: 1 } }),
			elapsedMs: 1,
		});

		const allow = await judgeToolCall({
			config: { ...defaultJudge(), whenUnsure: "allow" },
			backend,
			input: judgeInput(),
		});
		expect(allow.action).toBe("allow");
	});

	test("propagates a caller abort instead of falling back", async () => {
		const controller = new AbortController();
		const backend: JudgeBackend = {
			assess: async () => {
				controller.abort();
				throw new Error("aborted");
			},
		};

		await expect(
			judgeToolCall({
				config: defaultJudge(),
				backend,
				input: judgeInput(),
				signal: controller.signal,
			}),
		).rejects.toThrow("aborted");
	});
});

describe("probeJudge", () => {
	test("reports a reachable judge with its model and timing", async () => {
		const probe = await probeJudge(defaultJudge(), fakeRegistry());

		expect(probe.ok).toBe(true);
		expect(probe.model).toBe("typesafe/jev-latest");
		expect(probe.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	test("reports a failure", async () => {
		const registry = fakeRegistry({
			classify: async () => ({
				stopReason: "error",
				errorMessage: "No API key for provider: typesafe",
			}),
		});
		const probe = await probeJudge(defaultJudge(), registry);

		expect(probe.ok).toBe(false);
		expect(probe.detail).toContain("API key");
	});
});

function fakeContext(registry: ModelRegistry, hasUI = true): ExtensionContext {
	return {
		hasUI,
		cwd: "/repo",
		isProjectTrusted: () => true,
		signal: undefined,
		sessionManager: { buildContextEntries: () => [] },
		modelRegistry: registry,
	} as unknown as ExtensionContext;
}

function askConfig(judge: Partial<JudgeConfig> = {}): PermissionConfig {
	return { ...DEFAULT_CONFIG, judge: { ...defaultJudge(), ...judge } };
}

describe("judge report", () => {
	const base: JudgeRecord = {
		model: "typesafe/jev-latest",
		answers: {},
		elapsedMs: 1,
		at: 1,
		toolName: "bash",
		summary: "pnpm test",
		action: "allow",
		reason: "the judge approved this call",
	};

	test("summarizes the log newest first", () => {
		const text = judgeLogText([base, { ...base, summary: "rm -rf /", action: "deny" }]);
		expect(text).toContain("2 judge decisions");
		expect(text.indexOf("rm -rf /")).toBeLessThan(text.indexOf("pnpm test"));
	});

	test("marks the would-be action of a dry run", () => {
		const text = judgeLogText([{ ...base, dryRun: true, action: "deny" }]);
		expect(text).toContain("would deny");
	});

	test("describes a verdict with confidence, risk, model, and timing", () => {
		const record: JudgeRecord = {
			...base,
			dryRun: true,
			risk: 0.12,
			elapsedMs: 312,
			answers: { verdict: { choice: "allow", confidence: 0.94 } },
		};

		expect(judgeVerdictText(record)).toBe(
			"would approve, 94%, risk 0.12, 312ms, typesafe/jev-latest",
		);
	});

	test("lists the signals behind the verdict", () => {
		const record: JudgeRecord = {
			...base,
			answers: {
				reversibility: 0.2,
				sensitive_access: 0,
			},
		};

		expect(judgeSignalText(record)).toBe("reversibility 0.20, sensitive 0.00");
	});

	test("says when the judge saw the last message", () => {
		const record: JudgeRecord = { ...base, answers: {}, withIntent: true };
		expect(judgeSignalText(record)).toBe("saw your last message");
	});

	test("says when the judge saw what the session is doing too", () => {
		const record: JudgeRecord = { ...base, answers: {}, withIntent: true, withTasks: true };
		expect(judgeSignalText(record)).toBe("saw what the session is doing and your last message");
	});
});

describe("judgeGate", () => {
	const target = { summary: "pnpm test", levels: ["pnpm", "pnpm test"] };

	test("skips the judge without a UI unless headless judging is on", async () => {
		const outcome = await judgeGate({
			config: askConfig(),
			ctx: fakeContext(fakeRegistry(), false),
			toolName: "bash",
			target,
			rawInput: {},
			cache: new Map(),
			onStatus: () => {},
		});
		expect(outcome).toBeUndefined();
	});

	test("asks the classifier, reports status, and caches a clean verdict", async () => {
		const config = askConfig();
		const cache = new Map<string, NonNullable<Awaited<ReturnType<typeof judgeGate>>>>();
		const statuses: (string | undefined)[] = [];
		let calls = 0;
		const registry = fakeRegistry({
			classify: async () => {
				calls++;
				return {};
			},
		});

		const run = () =>
			judgeGate({
				config,
				ctx: fakeContext(registry),
				toolName: "bash",
				target,
				rawInput: {},
				cache,
				onStatus: (status) => statuses.push(status),
			});

		const first = await run();
		const second = await run();

		expect(first?.action).toBe("allow");
		expect(first?.record.model).toBe("typesafe/jev-latest");
		expect(second).toBe(first);
		expect(calls).toBe(1);
		expect(statuses).toEqual(["judge: considering bash", undefined]);
	});
});
