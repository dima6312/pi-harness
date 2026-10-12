// The permission ask, drawn by the questions feature so both dialogs are the same one. The call
// becomes a question, and the answer becomes the decision the gate already knows how to apply.
import { type AskAnswer, type AskOption, type AskQuestion, askQuestions } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SCOPE_LABEL, SCOPES, type Scope } from "#core/always-yes.ts";
import type { DialogAnswer, FolderOffer } from "#core/answer.ts";
import type { Call } from "#core/decide.ts";
import { describeHints } from "#core/mcp.ts";
import { openLabel } from "#ui/decision-options.ts";

const YES = "yes";
const ALWAYS = "always yes";
const DENY = "no";

export interface AskExtras {
	diff?: string;
	reason?: string;
	offer?: FolderOffer;
}

/** Undefined when the questions feature is not there to draw, or failed: the caller falls back. */
export async function askThroughQuestions(
	events: ExtensionAPI["events"],
	call: Call,
	extras: AskExtras,
): Promise<DialogAnswer | undefined> {
	const first = await askQuestions(events, [firstQuestion(call, extras)]);
	if (first.error !== undefined) return undefined;
	if (first.cancelled) return { decision: "deny" };

	const answer = first.answers[0];
	const note = noteOf(answer);
	// A typed answer instead of a pick: the user is telling the model what to do instead.
	if (answer === undefined || answer.picked.length === 0) return { decision: "deny", note };

	const picked = answer.picked[0] ?? "";
	if (picked === DENY) return { decision: "deny", note };
	if (picked === ALWAYS) return remember(events, call, note);

	const folder = folderOf(extras.offer, picked);
	if (folder === undefined) return { decision: "allow", note };
	const scope = await askScope(events, "Open the folder for how long?");
	return { decision: "allow", note, open: { path: folder, access: extras.offer!.access, scope } };
}

function firstQuestion(call: Call, extras: AskExtras): AskQuestion {
	const options: AskOption[] = [
		{ label: YES, description: "Run this call now, and ask again next time." },
		...(levelsOf(call).length > 0
			? [
					{
						label: ALWAYS,
						description: "Run this call, and stop asking for the calls you pick next.",
					},
				]
			: []),
		...offerOptions(extras.offer),
		{
			label: DENY,
			description: "Block it. A note on this answer becomes the reason the model reads.",
		},
	];

	// Every option offers the same preview, whichever row the cursor is on.
	if (extras.diff !== undefined) for (const option of options) option.preview = extras.diff;

	// The reason for a no is a note on it. A row of its own for words would say the same thing twice.
	return {
		header: "permission",
		question: questionText(call, extras.reason),
		options,
		typed: false,
	};
}

function offerOptions(offer: FolderOffer | undefined): { label: string; description: string }[] {
	if (offer === undefined) return [];
	const reads = offer.access === "read";
	return [
		{
			label: openLabel(offer, offer.folders[offer.suggested] ?? ""),
			description: reads
				? "Run it, and let later calls read there without asking."
				: "Run it, and treat that folder as part of the workspace.",
		},
	];
}

/** A heredoc or a long payload would fill the screen; a few lines say what the call is. */
const SUMMARY_LINES = 3;

function clipSummary(summary: string): string[] {
	const lines = summary.split("\n");
	if (lines.length <= SUMMARY_LINES) return lines;
	const more = lines.length - SUMMARY_LINES;
	return [...lines.slice(0, SUMMARY_LINES), `... ${more} more ${more === 1 ? "line" : "lines"}`];
}

function questionText(call: Call, reason: string | undefined): string {
	const lines = [
		`${whereOf(call)} wants to run:`,
		...clipSummary(call.target.summary).map((line) => `  ${line}`),
	];
	if (reason !== undefined) lines.push("", `\u25b2 ${reason}`);
	return lines.join("\n");
}

// The tool name, plus what it does not say: the server behind an MCP tool and what it declares, and
// a call a script issued rather than the model.
function whereOf(call: Call): string {
	const parts: string[] = [];
	if (call.mcp !== undefined)
		parts.push(`${call.mcp.server}:${call.mcp.tool} (${describeHints(call.hints)})`);
	else parts.push(call.toolName);
	if (call.nested) parts.push("(from a codemode script)");
	return parts.join(" ");
}

function levelsOf(call: Call): string[] {
	return [...call.target.levels].toReversed();
}

/** The always-yes path: which calls to remember, then for how long. */
async function remember(
	events: ExtensionAPI["events"],
	call: Call,
	note: string | undefined,
): Promise<DialogAnswer | undefined> {
	const levels = levelsOf(call);
	if (levels.length === 0) return { decision: "allow", note };

	const picked = await askQuestions(events, [
		{
			header: "remember",
			typed: false,
			question: `Always say yes to which calls, from ${call.toolName}?`,
			options: levels.map((level, index) => ({
				label: level,
				description:
					index === 0
						? "Only this exact call."
						: "This call, and anything else that starts with it.",
			})),
		},
	]);
	if (picked.error !== undefined || picked.cancelled) return { decision: "allow", note };

	const level = picked.answers[0]?.picked[0];
	if (level === undefined || level === "") return { decision: "allow", note };
	const scope = await askScope(events, "Remember it for how long?");
	return { decision: "allow", note, remember: level, scope };
}

async function askScope(events: ExtensionAPI["events"], question: string): Promise<Scope> {
	const result = await askQuestions(events, [
		{
			header: "where",
			typed: false,
			question,
			options: SCOPES.map((scope) => ({
				label: SCOPE_LABEL[scope],
				description:
					scope === "session"
						? "Gone when this session ends."
						: scope === "project"
							? "Saved for this project, in its own file."
							: "Saved for every project.",
			})),
		},
	]);
	const picked = result.answers[0]?.picked[0];
	const scope = SCOPES.find((candidate) => SCOPE_LABEL[candidate] === picked);
	return scope ?? "session";
}

function folderOf(offer: FolderOffer | undefined, picked: string): string | undefined {
	if (offer === undefined) return undefined;
	return offer.folders.find((folder) => openLabel(offer, folder) === picked);
}

/** Every note the user left, the picked option's first. */
function noteOf(answer: AskAnswer | undefined): string | undefined {
	if (answer === undefined) return undefined;
	const parts: string[] = [];
	const picked = answer.notes.find((note) => answer.picked.includes(note.option));
	if (picked !== undefined) parts.push(picked.note);
	for (const note of answer.notes)
		if (!answer.picked.includes(note.option)) parts.push(`on "${note.option}": ${note.note}`);
	const typed = answer.typed?.trim();
	if (typed !== undefined && typed !== "") parts.push(typed);

	return parts.length === 0 ? undefined : parts.join("\n");
}
