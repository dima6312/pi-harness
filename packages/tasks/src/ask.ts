// The model answers with operations, never a new list, so it cannot rewrite what happened.
import { modelRef, type SessionTasks, type TaskOp, type TasksUsage } from "@adeildo/pi-kit";
import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Checked, messageOps, runOps, tidyOps } from "./ops.ts";
import {
	type MessageRequest,
	messagePrompt,
	type Moment,
	PROMPTS,
	runPrompt,
	tidyPrompt,
	TOOL,
} from "./prompts.ts";
import { SCHEMAS } from "./schemas.ts";
import type { Line } from "./transcript.ts";

export interface Proposal {
	ops: TaskOp[];
	rejected: TaskOp[];
	model: string;
	usage: TasksUsage;
}

type Registry = Pick<ExtensionContext["modelRegistry"], "streamSimple">;

export interface Asker {
	registry: Registry;
	/** Tried in order: the next one answers only when the one before fails. */
	models: readonly Model<Api>[];
	signal: AbortSignal;
}

export function onMessage(asker: Asker, request: MessageRequest): Promise<Proposal | undefined> {
	return ask(asker, "message", messagePrompt(request), (answer) => messageOps(answer, request));
}

export function onRun(
	asker: Asker,
	request: { state: SessionTasks; run: string; lines: readonly Line[] },
): Promise<Proposal | undefined> {
	return ask(asker, "run", runPrompt(request), (answer) =>
		runOps(answer, request.lines, request.state),
	);
}

export function onTidy(asker: Asker, state: SessionTasks): Promise<Proposal | undefined> {
	return ask(asker, "tidy", tidyPrompt(state), (answer) => tidyOps(answer, state));
}

function toolFor(moment: Moment): Tool {
	return {
		name: TOOL,
		description: "Apply changes to the session's task list. Empty lists change nothing.",
		parameters: SCHEMAS[moment],
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
}

async function ask(
	{ registry, models, signal }: Asker,
	moment: Moment,
	content: string,
	check: (answer: unknown) => Checked,
): Promise<Proposal | undefined> {
	for (const model of models) {
		// oxlint-disable-next-line no-await-in-loop -- the next model is only for when this one fails
		const answer = await call(registry, model, moment, content, signal).catch(() => undefined);
		if (signal.aborted) return undefined;
		if (answer === undefined) continue;
		return { ...check(answer.args), model: modelRef(model), usage: answer.usage };
	}
	return undefined;
}

async function call(
	registry: Registry,
	model: Model<Api>,
	moment: Moment,
	content: string,
	signal: AbortSignal,
): Promise<{ args: unknown; usage: TasksUsage } | undefined> {
	const reply = await registry
		.streamSimple(
			model,
			{
				systemPrompt: PROMPTS[moment],
				tools: [toolFor(moment)],
				messages: [{ role: "user", content, timestamp: Date.now() }],
			},
			{ signal },
		)
		.result();
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return undefined;
	// An answer in words instead of a call is a model with nothing to change.
	const tool = reply.content.find((part) => part.type === "toolCall" && part.name === TOOL);
	const args = tool?.type === "toolCall" ? tool.arguments : {};
	const { input, output, cost } = reply.usage;
	return { args, usage: { input, output, cost: cost.total } };
}
