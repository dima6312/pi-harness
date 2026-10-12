import type { CallDescriptor } from "#core/tools.ts";

export interface JudgeInput {
	toolName: string;
	target: CallDescriptor;
	rawInput: unknown;
	cwd: string;
	policy: string;
	/** Where the call comes from, when the tool name does not say it. */
	source?: string;
	/** What the tool says it does, for a tool the judge cannot know by name. Not verified. */
	toolDescription?: string;
	/**
	 * What the user is after right now. The judge reads it as context and never as a permission, so
	 * the policy still decides. The judge does not know where it comes from.
	 */
	intent?: string;
}

export type JudgeChoice = "allow" | "deny" | "needs_human";

export interface JudgeChoiceAnswer {
	choice: JudgeChoice;
	confidence: number;
}

export interface JudgeAnswers {
	verdict?: JudgeChoiceAnswer;
	reversibility?: number;
	sensitive_access?: number;
}

export interface JudgeUsage {
	input?: number;
	output?: number;
}

export interface JudgeAssessment {
	model: string;
	answers: JudgeAnswers;
	elapsedMs: number;
	usage?: JudgeUsage;
}

export interface JudgeBackend {
	assess(input: JudgeInput, signal: AbortSignal): Promise<JudgeAssessment>;
}

export type JudgeAction = "allow" | "deny" | "ask";

export interface JudgeRecord extends JudgeAssessment {
	at: number;
	toolName: string;
	summary: string;
	risk?: number;
	action: JudgeAction;
	reason: string;
	error?: string;

	dryRun?: boolean;
	/** The request carried the intent, so the card says it went to the judge's provider. */
	withIntent?: boolean;
	/** The intent carried the session or what it is doing, not only the last message. */
	withTasks?: boolean;
}

export interface JudgeOutcome {
	action: JudgeAction;
	reason: string;
	record: JudgeRecord;
}

export class JudgeError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "JudgeError";
	}
}
