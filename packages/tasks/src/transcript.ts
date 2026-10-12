// What the tasks' model reads of the branch. Tool output stays out, since it could carry
// instructions; a call shows only its name, its target and whether it failed. The one exception is
// your answers in the questions dialog, which are your words.
import { describeAnswers, isAnswered, isAskResult } from "@adeildo/pi-kit";

const MAX_RUN = 9000;
const MAX_SAID = 500;
/** The agent's report at the end of a run is what says what was done, so more of it is kept. */
const MAX_REPORT = 1500;
const MAX_CALL = 100;
const MAX_MESSAGE = 2000;
const MAX_REPLY = 800;

interface Entry {
	id?: string;
	type?: string;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		toolCallId?: unknown;
		toolName?: unknown;
		isError?: unknown;
		details?: unknown;
	};
}

interface Part {
	type?: string;
	id?: unknown;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
}

export type LineKind = "you" | "said" | "report" | "call";

export interface Line {
	/** `L1`, `L2`, as the model cites them. */
	ref: string;
	kind: LineKind;
	text: string;
	at?: number;
	/** A call that failed or that you refused. */
	failed?: boolean;
}

export interface Run {
	lines: Line[];
	/** The lines as the model reads them, one per row, each after its ref. */
	text: string;
	from?: string;
	to?: string;
}

/** Everything on the branch after `after`: your messages, the agent's words and its calls. */
export function runSince(branch: readonly unknown[], after: string | undefined): Run {
	const entries = branch as readonly Entry[];
	const start = after === undefined ? 0 : entries.findIndex((entry) => entry.id === after) + 1;
	const read = entries.slice(start);
	const failed = failedCalls(read);
	const reportAt = read.findLastIndex((entry) => assistantText(entry) !== "");

	const lines: Omit<Line, "ref">[] = [];
	read.forEach((entry, index) => {
		const parsed = Date.parse(entry.timestamp ?? "");
		const at = Number.isNaN(parsed) ? {} : { at: parsed };
		const yours = entry.type === "message" ? yourWords(entry.message) : undefined;
		if (yours !== undefined)
			lines.push({ kind: "you", text: clip(oneLine(yours), MAX_SAID), ...at });
		const report = index === reportAt;
		for (const paragraph of paragraphs(assistantText(entry)))
			lines.push({
				kind: report ? "report" : "said",
				text: clip(oneLine(paragraph), report ? MAX_REPORT : MAX_SAID),
				...at,
			});
		for (const part of assistantParts(entry)) {
			if (part.type !== "toolCall" || typeof part.name !== "string") continue;
			const call = { kind: "call" as const, text: callOf(part.name, part.arguments), ...at };
			lines.push(failed.has(part.id) ? { ...call, failed: true } : call);
		}
	});

	const kept: Line[] = newest(lines, MAX_RUN).map((line, index) =>
		Object.assign(line, { ref: `L${index + 1}` }),
	);
	return {
		lines: kept,
		text: kept.map(showLine).join("\n"),
		from: read[0]?.id,
		to: read.at(-1)?.id,
	};
}

function showLine(line: Line): string {
	const outcome = line.failed ? " (failed or refused: it did not happen)" : "";
	return `${line.ref} ${line.kind}: ${line.text}${outcome}`;
}

/** Only the error flag is read, never the output. */
function failedCalls(read: readonly Entry[]): Set<unknown> {
	const ids = read.flatMap((entry) =>
		entry.message?.role === "toolResult" && entry.message.isError === true
			? [entry.message.toolCallId]
			: [],
	);
	return new Set(ids);
}

function callOf(name: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	const target = [fields.path, fields.command, fields.query, fields.url].find(
		(value): value is string => typeof value === "string" && value.trim() !== "",
	);
	const shown = target === undefined ? JSON.stringify(fields) : (target.split("\n")[0] ?? "");
	return `${name} ${clip(shown, MAX_CALL)}`;
}

/** The newest lines that fit, since the end of a run says the most about what got done. */
function newest<T extends { text: string }>(lines: readonly T[], max: number): T[] {
	const kept: T[] = [];
	let size = 0;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index];
		if (line === undefined) continue;
		if (size + line.text.length > max && kept.length > 0) break;
		kept.unshift(line);
		size += line.text.length + 8;
	}
	return kept;
}

/** What you wrote in a message, without the skill blocks pi expands into it. */
export function operatorText(message: unknown): string | undefined {
	const { role, content } = asMessage(message);
	if (role !== "user") return undefined;
	const text = textOf(content)
		.replace(/<skill name="[^"]*"[^>]*>[\s\S]*?<\/skill>/g, "")
		.trim();
	return text === "" ? undefined : text;
}

export const QUESTIONS_TOOL = "ask_questions";

/** What you wrote: a message, or your answers to the agent's questions. */
export function yourWords(message: unknown): string | undefined {
	return operatorText(message) ?? answerWords(message);
}

function answerWords(message: unknown): string | undefined {
	const { role, toolName, details } = asMessage(message);
	if (role !== "toolResult" || toolName !== QUESTIONS_TOOL || !isAskResult(details))
		return undefined;
	// A closed dialog answers nothing, even where you had picked before closing it.
	const answered = details.cancelled ? [] : details.answers.filter(isAnswered);
	if (answered.length === 0) return undefined;
	return ["Answering the agent's questions:", ...describeAnswers(answered)].join("\n");
}

export interface Heard {
	/** The entry of your message, once it is in the session. */
	entry?: string;
	/** What the agent said last before it, which "yes, do it" answers. */
	reply?: string;
}

/** Where your message sits on the branch, and what the agent said just before it. */
export function heard(branch: readonly unknown[], text: string): Heard {
	const entries = branch as readonly Entry[];
	const at = entries.findLastIndex(
		(entry) => entry.type === "message" && yourWords(entry.message) === text,
	);
	const before = at === -1 ? entries : entries.slice(0, at);
	const reply = before.findLast((entry) => assistantText(entry) !== "");
	const words = reply === undefined ? "" : assistantText(reply);
	return {
		...(at === -1 ? {} : { entry: entries[at]?.id }),
		...(words === "" ? {} : { reply: clip(oneLine(words), MAX_REPLY) }),
	};
}

/** A long message keeps its start and its end, where what you ask of something you pasted usually is. */
export function clipMessage(text: string): string {
	if (text.length <= MAX_MESSAGE) return text;
	const head = Math.floor(MAX_MESSAGE / 3);
	const tail = MAX_MESSAGE - head;
	return `${text.slice(0, head).trimEnd()}\n(\u2026 ${text.length - MAX_MESSAGE} characters left out \u2026)\n${text.slice(-tail).trimStart()}`;
}

export interface SkillNote {
	name: string;
	description?: string;
}

/** `/skill:name` reads as a bare command to the model, so each one becomes the ask it is. */
export function withSkills(text: string, skills: readonly SkillNote[]): string {
	return text.replace(/\/skill:([\w.-]+)/g, (reference, name: string) => {
		const description = skills.find((skill) => skill.name === name)?.description;
		if (description === undefined) return reference;
		return `run the skill "${name}" (${clip(oneLine(description), 200)})`;
	});
}

function asMessage(message: unknown): NonNullable<Entry["message"]> {
	return typeof message === "object" && message !== null ? message : {};
}

function assistantText(entry: Entry): string {
	return assistantParts(entry)
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n\n")
		.trim();
}

function assistantParts(entry: Entry): Part[] {
	if (entry.type !== "message" || entry.message?.role !== "assistant") return [];
	const content = entry.message.content;
	return Array.isArray(content) ? (content as Part[]) : [];
}

function paragraphs(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return (content as Part[])
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n")
		.trim();
}

function oneLine(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}
