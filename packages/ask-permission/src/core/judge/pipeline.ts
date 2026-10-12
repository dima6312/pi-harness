import {
	composeVerdict,
	judgeRisk,
	alwaysAskMatches,
	type ComposedVerdict,
} from "#core/judge/compose.ts";
import type { JudgeConfig } from "#core/judge/config.ts";
import {
	JudgeError,
	type JudgeAction,
	type JudgeBackend,
	type JudgeInput,
	type JudgeOutcome,
	type JudgeRecord,
} from "#core/judge/types.ts";
import { describe } from "#util/primitives.ts";

export interface JudgeCallOptions {
	config: JudgeConfig;
	backend: JudgeBackend;
	input: JudgeInput;
	signal?: AbortSignal;
}

export async function judgeToolCall(options: JudgeCallOptions): Promise<JudgeOutcome> {
	const { config, backend, input } = options;

	// A readable label replaces the registered name in `levels` for an MCP call, so the tool name is
	// matched on its own.
	const values = [input.toolName, input.target.summary, ...input.target.levels];
	if (alwaysAskMatches(config, values)) {
		const reason = "it matches judge.alwaysAsk";
		return { action: "ask", reason, record: blankRecord(config, input, reason) };
	}

	const signal = options.signal ?? new AbortController().signal;

	let assessment: Awaited<ReturnType<JudgeBackend["assess"]>>;
	try {
		assessment = await backend.assess(input, signal);
	} catch (error) {
		if (options.signal?.aborted) throw error;

		const reason = `the judge could not decide: ${describe(error)}`;
		const wouldAct: JudgeAction = config.whenItFails === "deny" ? "deny" : "ask";
		const { action, dryRun } = resolveAction(config, wouldAct);

		const record = blankRecord(config, input, reason);
		record.action = wouldAct;
		record.error = error instanceof JudgeError ? error.code : "error";
		record.dryRun = dryRun || undefined;
		return { action, reason, record };
	}

	const composed = composeVerdict(config, assessment.answers);
	const risk = composed.risk ?? judgeRisk(assessment.answers);

	const wouldAct: JudgeAction =
		composed.decision === "uncertain" ? config.whenUnsure : composed.decision;
	const { action, dryRun } = resolveAction(config, wouldAct);
	const reason = describeOutcome(composed.reason, composed.decision, config);

	const record: JudgeRecord = {
		...assessment,
		at: Date.now(),
		toolName: input.toolName,
		summary: input.target.summary,
		risk,
		action: wouldAct,
		reason,
		dryRun: dryRun || undefined,
		withIntent: input.intent?.trim() ? true : undefined,
		withTasks: /^(Session|Doing): /m.test(input.intent ?? "") ? true : undefined,
	};

	return { action, reason, record };
}

function resolveAction(
	config: JudgeConfig,
	wouldAct: JudgeAction,
): { action: JudgeAction; dryRun: boolean } {
	const dryRun = config.dryRun && wouldAct !== "ask";
	return { action: dryRun ? "ask" : wouldAct, dryRun };
}

// An empty policy is the usual reason the judge approves nothing.
function describeOutcome(
	reason: string,
	decision: ComposedVerdict["decision"],
	config: JudgeConfig,
): string {
	if (decision === "uncertain" && config.policy.trim() === "")
		return "no policy is set, so the judge approves nothing";
	return reason;
}

function blankRecord(config: JudgeConfig, input: JudgeInput, reason: string): JudgeRecord {
	return {
		model: config.model,
		answers: {},
		elapsedMs: 0,
		at: Date.now(),
		toolName: input.toolName,
		summary: input.target.summary,
		action: "ask",
		reason,
	};
}
