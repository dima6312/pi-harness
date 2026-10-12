// Does Anthropic's own clearing keep the cache and the thinking? A scripted agent reads a long log
// one chunk per turn, with clear_tool_uses on, and each request's cache numbers and dropped
// thinking blocks are printed. At the end the agent quotes what it sees in place of chunk 1.
//
// bun packages/compact/eval/server.ts [--model anthropic/claude-haiku-5-5] [--off] [--inputs]
import { parseArgs } from "node:util";

import { type AssistantMessage, type Message, Type } from "@earendil-works/pi-ai";

import { modelNamed, signedIn } from "../../tasks/eval/signin.ts";

const { values } = parseArgs({
	options: {
		model: { type: "string", default: "anthropic/claude-haiku-5-5" },
		chunks: { type: "string", default: "12" },
		off: { type: "boolean", default: false },
		inputs: { type: "boolean", default: false },
	},
});

const CHUNK_LINES = 400;
const CONTEXT_MANAGEMENT = {
	edits: [
		{
			type: "clear_tool_uses_20250919",
			clear_tool_inputs: values.inputs,
			trigger: { type: "input_tokens", value: 30_000 },
			keep: { type: "tool_uses", value: 3 },
			clear_at_least: { type: "input_tokens", value: 10_000 },
		},
	],
};
const SYSTEM = `You audit a sensor log one chunk at a time. Call read_chunk with n = 1, then n = 2, and so on, one call per turn. After each result, write one short sentence on the highest value in it, then call the next chunk. After chunk ${values.chunks}, stop calling tools.`;
const TOOLS = [
	{
		name: "read_chunk",
		description: "Returns chunk n of the sensor log.",
		parameters: Type.Object({ n: Type.Number() }),
	},
];

const registry = await signedIn();
const model = modelNamed(registry, values.model);
const messages: Message[] = [{ role: "user", content: "Start the audit.", timestamp: Date.now() }];
let spent = 0;

console.log("req  prompt  cacheRead  cacheWrite  input  thinking-dropped  thinking-in-reply");
for (let request = 1; request <= Number(values.chunks) + 2; request++) {
	// oxlint-disable-next-line no-await-in-loop -- each turn needs the one before
	const reply = await turn(messages);
	messages.push(reply);
	const call = reply.content.find((part) => part.type === "toolCall");
	if (call === undefined) break;
	const n = Number((call.arguments as { n?: number }).n ?? request);
	messages.push({
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: chunk(n) }],
		isError: false,
		timestamp: Date.now(),
	});
}

messages.push({
	role: "user",
	content:
		"Quote, word for word, what you see right now as your first read_chunk call (its parameters) and as its result. If they are not there, quote what is there instead.",
	timestamp: Date.now(),
});
const last = await turn(messages);
console.log(`\nIn place of chunk 1: ${textOf(last)}`);
console.log(`\n$${spent.toFixed(3)} spent`);

async function turn(history: Message[]): Promise<AssistantMessage> {
	const reply = await registry
		.streamSimple(
			model,
			{ systemPrompt: SYSTEM, messages: history, tools: TOOLS },
			{
				reasoning: "low",
				onPayload: (payload) => (values.off ? undefined : withClearing(payload)),
			},
		)
		.result();
	if (reply.stopReason === "error") throw new Error(reply.errorMessage ?? "failed");
	spent += reply.usage.cost.total;
	const { input, cacheRead, cacheWrite } = reply.usage;
	const dropped = (reply.diagnostics ?? [])
		.flatMap((diagnostic) =>
			diagnostic.type === "anthropic_input_transformations"
				? ((diagnostic.details as { transformations?: { type?: string }[] }).transformations ?? [])
				: [],
		)
		.filter((transformation) => transformation.type === "thinking_dropped").length;
	const thinking = reply.content.filter((part) => part.type === "thinking").length;
	console.log(
		[
			String(history.filter((message) => message.role === "assistant").length + 1).padEnd(4),
			String(input + cacheRead + cacheWrite).padEnd(7),
			String(cacheRead).padEnd(10),
			String(cacheWrite).padEnd(11),
			String(input).padEnd(6),
			String(dropped).padEnd(17),
			String(thinking),
		].join(" "),
	);
	return reply;
}

function withClearing(payload: unknown): unknown {
	const body = payload as { betas?: string[] };
	return {
		...body,
		betas: [...(body.betas ?? []), "context-management-2025-06-27"],
		context_management: CONTEXT_MANAGEMENT,
	};
}

/** About 6k tokens of log lines, different in every chunk, with one peak to report. */
function chunk(n: number): string {
	const lines: string[] = [];
	for (let line = 1; line <= CHUNK_LINES; line++) {
		const value = ((n * 7919 + line * 104_729) % 9973) / 100;
		lines.push(`chunk ${n} line ${line}: sensor-${(line % 17) + 1} reads ${value.toFixed(2)}`);
	}
	lines.push(
		`chunk ${n} line ${CHUNK_LINES + 1}: sensor-9 peaks at ${(n * 11.5 + 120).toFixed(1)}`,
	);
	return lines.join("\n");
}

function textOf(message: AssistantMessage): string {
	return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
}
