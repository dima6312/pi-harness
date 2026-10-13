import { createEventBus, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { SCOPE_LABEL } from "../../packages/ask-permission/src/core/always-yes.ts";
import type { FolderOffer } from "../../packages/ask-permission/src/core/answer.ts";
import { defaultConfig } from "../../packages/ask-permission/src/core/config/schema.ts";
import { type Call, describeCall } from "../../packages/ask-permission/src/core/decide.ts";
import {
	type AskExtras,
	askThroughQuestions,
} from "../../packages/ask-permission/src/ui/questions.ts";
import type { QuestionDialog } from "../../packages/ask-questions/src/ui/dialog.ts";
// A scene `pkg/file` draws `packages/pkg/assets/file.png`. A page shows it with an empty
// `<!-- docs:pkg/file -->` `<!-- /docs -->` block, which `bun run docs` fills.
import {
	ANSWER,
	ASK,
	type AskQuestion,
	type AskRequest,
	type AskResult,
	AVAILABLE,
} from "../../packages/kit/src/index.ts";
import { drawCalls, type CallSpec } from "./calls.ts";
import { pruneLine } from "./compact.ts";
import { KEYS, openDialog, press, type, WIDTH } from "./drive.ts";
import { drawLook, lookParts } from "./look.ts";
import { assistantText, userMessage } from "./messages.ts";
import { peersRoom } from "./peers.ts";
import { tasksPanel } from "./tasks.ts";

export interface Scene {
	name: string;
	caption: string;
	alt: string;
	draw(theme: Theme): string[] | Promise<string[]>;
}

const LAYOUT: AskQuestion = {
	header: "Layout",
	question: "Which layout should the accounts section use?",
	options: [
		{
			label: "Tree (Recommended)",
			description: "Provider first, then its accounts. Scales to many providers.",
			preview:
				"```\nAnthropic\n  ● work   active\n  ○ home\n  + add account\nOpenAI\n  ○ personal\n```",
		},
		{
			label: "Flat list",
			description: "One row per account, with the provider as a column.",
			preview:
				"```\n● work      Anthropic   active\n○ home      Anthropic\n○ personal  OpenAI\n```",
		},
	],
};

const SCOPE: AskQuestion = {
	header: "Scope",
	question: "Where should the choice be remembered?",
	options: [
		{ label: "This session", description: "Gone when the session ends." },
		{ label: "This project", description: "Every session in this folder." },
	],
};

const RULES: AskQuestion = {
	header: "Rules",
	question: "Which of these rules should the docs follow?",
	multiSelect: true,
	options: [
		{ label: "Sentence case", description: "Headings start with a capital and nothing else." },
		{ label: "One idea per sentence", description: "Split what makes the reader backtrack." },
		{ label: "Examples from the code", description: "A generated example cannot go stale." },
	],
};

function questionsDialog(theme: Theme, width: number = WIDTH): string[] {
	const dialog = openDialog(theme, [LAYOUT, SCOPE], width);
	press(dialog, KEYS.tab);
	type(dialog, "my pick");
	press(dialog, KEYS.enter);
	return dialog.render(width);
}

function questionsMulti(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, RULES]);
	press(dialog, KEYS.enter, KEYS.space, KEYS.down, KEYS.down, KEYS.space);
	return dialog.render(WIDTH);
}

/** A note on the pick and one on the option turned down, an answer in your words, then two rules. */
function answerAll(dialog: QuestionDialog): void {
	press(dialog, KEYS.tab);
	type(dialog, "fits how I think");
	press(dialog, KEYS.enter, KEYS.down, KEYS.tab);
	type(dialog, "too long with five accounts");
	press(dialog, KEYS.enter, KEYS.up, KEYS.enter, KEYS.down, KEYS.down);
	type(dialog, "only on this branch");
	press(dialog, KEYS.enter, KEYS.space, KEYS.down, KEYS.space, KEYS.enter);
}

function questionsReview(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, SCOPE, RULES]);
	answerAll(dialog);
	return dialog.render(WIDTH);
}

/** The call while the model writes it, then once you answered. */
function questionsTranscript(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, SCOPE, RULES], WIDTH, (result) => (answered = result));
	let answered: AskResult | undefined;
	answerAll(dialog);
	press(dialog, KEYS.enter);
	const questions = [LAYOUT, SCOPE, RULES];
	const writing = {
		questions: [LAYOUT, { ...SCOPE, question: "Where should the choice", options: [] }],
	};
	return drawCalls(
		[
			{ tool: "ask_questions", args: writing, writing: true, wroteMs: 6_400, ranMs: 0 },
			{
				tool: "ask_questions",
				args: { questions },
				output: "",
				details: answered,
				wroteMs: 9_100,
				ranMs: 41_000,
			},
		],
		WIDTH,
	);
}

function chosen(header: string, option: string): AskResult {
	return { answers: [{ question: "q", header, picked: [option], notes: [] }], cancelled: false };
}

/** Runs the permission ask against a scripted answerer and returns every question it asked. */
async function asked(call: Call, extras: AskExtras, script: AskResult[]): Promise<AskQuestion[]> {
	const bus = createEventBus();
	const questions: AskQuestion[] = [];
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		questions.push(...request.questions);
		const result = script.shift() ?? { answers: [], cancelled: true };
		bus.emit(ANSWER, { id: request.id, result });
	});
	await askThroughQuestions(bus, call, extras);
	return questions;
}

function callOf(toolName: string, input: unknown): Call {
	return describeCall(toolName, input, "/repo", defaultConfig());
}

function required(question: AskQuestion | undefined, what: string): AskQuestion {
	if (question === undefined) throw new Error(`${what} did not ask`);
	return question;
}

async function permissionAsk(theme: Theme, width: number = WIDTH): Promise<string[]> {
	const questions = await asked(
		callOf("bash", { command: "npm install" }),
		{ reason: "the judge leaned deny but was only 61% confident" },
		[chosen("permission", "no")],
	);
	const dialog = openDialog(theme, [required(questions[0], "the permission ask")], width);
	press(dialog, KEYS.down, KEYS.down, KEYS.tab);
	type(dialog, "use pnpm instead");
	press(dialog, KEYS.enter);
	return dialog.render(width);
}

async function permissionRemember(theme: Theme): Promise<string[]> {
	const call = callOf("bash", { command: "pnpm test" });
	const narrowest = [...call.target.levels].toReversed()[0] ?? "";
	const questions = await asked(call, {}, [
		chosen("permission", "always yes"),
		chosen("remember", narrowest),
		chosen("where", SCOPE_LABEL.session),
	]);
	const remember = questions.find((question) => question.header === "remember");
	return openDialog(theme, [required(remember, "always yes")]).render(WIDTH);
}

async function permissionFolder(theme: Theme): Promise<string[]> {
	const offer = {
		access: "read",
		folders: ["/home/me/Projects/grace", "/home/me/Projects/grace/apps"],
		suggested: 0,
		repoRoot: "/home/me/Projects/grace",
	} as unknown as FolderOffer;
	const questions = await asked(
		callOf("bash", { command: "cd ~/Projects/grace/apps/web && git status --short | head" }),
		{ reason: "reads outside the workspace", offer },
		[chosen("permission", "no")],
	);
	const dialog = openDialog(theme, [required(questions[0], "the permission ask")]);
	press(dialog, KEYS.down, KEYS.down);
	return dialog.render(WIDTH);
}

/** The call the pictures agree on: the suite passing, allowed by the judge. */
function testsPassed(): CallSpec {
	return {
		tool: "bash",
		args: { command: "bun run test" },
		output: "583 pass\n0 fail",
		wroteMs: 2_100,
		ranMs: 6_800,
		ruling: { tone: "success", head: "judge approved", why: "97% sure, risk 0.12" },
	};
}

function lookCall(): string[] {
	return drawCalls(
		[
			testsPassed(),
			{
				tool: "read",
				args: { path: "src/ui/tool-frame.ts" },
				output: "export function registerToolFrames(scope: FeatureScope): void {\n  // ...",
				wroteMs: 900,
				ranMs: 400,
				ruling: { tone: "success", head: "always yes", why: "read, this project" },
			},
			{
				tool: "bash",
				args: { command: "pnpm test --watch" },
				output: "✓ core  (0.31 seconds)",
				wroteMs: 1_200,
				ranMs: 3_200,
				running: true,
				ruling: { tone: "warning", head: "asking you", why: "the judge wants a person to decide" },
			},
		],
		WIDTH,
	);
}

/** The look, with a session in it: what you asked, what the model ran, and what it cost. */
function conversation(theme: Theme): string[] {
	const look = lookParts(theme, "");
	const opening = [
		...look.header,
		...userMessage("commit with a semantic message and push", WIDTH),
		...assistantText("Running the tests first.", WIDTH),
		...drawCalls(
			[
				{
					tool: "bash",
					args: {
						command:
							'bun run verify && git commit -am "fix: keep the answer on one line" && git push',
					},
					output: [
						"✓ 583 pass (5.4s)",
						"✓ types (5.5s)",
						"[main 4f0a7a9] fix: keep the answer on one line",
						"✓ pushed to origin/main",
					].join("\n"),
					wroteMs: 2_100,
					ranMs: 12_400,
					ruling: { tone: "success", head: "judge approved", why: "97% sure, risk 0.12" },
				},
			],
			WIDTH,
		),
		...assistantText("Done. CI is running on it.", WIDTH),
	];
	return [...blocks(opening), ...look.strip, ...look.editor, ...look.footer];
}

/** One blank line between the blocks of a session, and none inside them. */
function blocks(lines: readonly string[]): string[] {
	const out: string[] = [];
	for (const line of lines) {
		if (!isBlank(line)) out.push(line);
		else if (out.length > 0 && !isBlank(out.at(-1))) out.push("");
	}
	return out;
}

function isBlank(line: string | undefined): boolean {
	return stripTerminalSequences(line ?? "").trim() === "";
}

/** Narrow enough that two pictures sit side by side on a README, and still read. */
const NARROW = 56;

export const SCENES: readonly Scene[] = [
	{
		name: "ask-questions/preview",
		caption: "Two questions as tabs, and the preview of the focused option.",
		alt: "The question dialog: two questions as tabs, the options on the left, and on the right the description and the preview of the focused option.",
		draw: questionsDialog,
	},
	{
		name: "ask-questions/multi",
		caption: "A question that takes several answers.",
		alt: "A question that takes several answers, with two of its three options checked.",
		draw: questionsMulti,
	},
	{
		name: "ask-questions/review",
		caption: "Every answer on one tab, before it goes to the model.",
		alt: "The review tab: every question with its answer, before submitting.",
		draw: questionsReview,
	},
	{
		name: "ask-questions/transcript",
		caption:
			"In the chat: the questions as the model writes them, then each one with your answer and notes.",
		alt: "Two ask_questions calls in the chat. The first is still being written and lists the questions so far. The second lists each question with the picked option, a note under it, a note on an option not picked, and an answer in quotes.",
		draw: questionsTranscript,
	},
	{
		name: "ask-permission/preview",
		caption: "No, with a note the model reads: use pnpm instead.",
		alt: "The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead.",
		draw: permissionAsk,
	},
	{
		name: "harness/permission",
		caption: "The permission ask, drawn at the width a pair fits in.",
		alt: "The permission dialog for npm install, narrow: the command, the reason it asks, the three answers, the note on no, and the keys.",
		draw: (theme) => permissionAsk(theme, NARROW),
	},
	{
		name: "harness/questions",
		caption: "A question from the model, drawn at the width a pair fits in.",
		alt: "The question dialog, narrow: two tabs, the options, and the panel with the description and the preview below them.",
		draw: (theme) => questionsDialog(theme, NARROW),
	},
	{
		name: "ask-permission/remember",
		caption: "Always yes asks which calls to remember.",
		alt: "After always yes, the dialog asks which calls to remember: this exact call, or every pnpm call.",
		draw: permissionRemember,
	},
	{
		name: "ask-permission/folder",
		caption: "A read outside the workspace can open that folder for reads.",
		alt: "A read outside the workspace, with an answer that also allows reads in that folder.",
		draw: permissionFolder,
	},
	{
		name: "look/call",
		caption: "One command that ran, one a rule let through, and one still going.",
		alt: "Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running.",
		draw: lookCall,
	},
	{
		name: "look/preview",
		caption: "The start card, then a prompt halfway through its answer.",
		alt: "Pi with the look: the start card, then the strip with the stopwatch and the last call, the task under way with how many wait, are queued and are done, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds.",
		draw: drawLook,
	},
	{
		name: "tasks/panel",
		caption:
			"Alt+T: what the agent is doing, what waits on you, what is queued, what got done and what was decided.",
		alt: "The session's tasks over the chat: the session as the title, one task under way, one waiting on you with the cursor on it, two queued, four done with the time each finished, one decision, and a pane with the selected task's reason.",
		draw: tasksPanel,
	},
	{
		name: "compact/prune",
		caption: "A prune's line, and the one cache rewrite it costs on the next request.",
		alt: "After a tool call, the prune's line: 181 old tool outputs hidden, 705k to 250k tokens, and below it what the next request pays to rewrite the cache and in how many requests that pays back. Then pi's cache miss notice for that rewrite.",
		draw: pruneLine,
	},
	{
		name: "peers/room",
		caption:
			"Alt+G: the agents in this folder and what each is doing, beside the room you all talk in and write to.",
		alt: "The room panel in a rounded frame, in two columns. On the left the agents: oauth selected, waiting on you to push, on the OAuth callback, with the files it edited; migration idle; this session last, rewriting the README. On the right the room: your request to switch the login to OAuth with the bids as bars and oauth taking it, migration's commit, oauth asking migration about src/auth.ts with woke it at the end of the line, migration's answer hanging under the question with its rail still lit, oauth writing back live, and under it all the line you write in.",
		draw: (theme) => peersRoom(theme),
	},
	{
		name: "harness/conversation",
		caption: "A session: the start card, what you asked, what the model ran, and what it cost.",
		alt: "A session with the look: the start card, a request, the model running the tests, committing and pushing, then the stopwatch, the task under way, the editor and the cost.",
		draw: conversation,
	},
];
