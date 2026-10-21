// A message you type that mentions another agent goes to that agent and not to yours. `@name` sends
// it to one agent. `@everyone` sends it to every agent in the folder, yours included. `@anyone` asks
// them all, and the one that fits it best takes it while the others see who did. Pi also uses
// `@` to attach files, so only the name of an open session counts, and the list that opens after
// `@` shows the agents above the files.
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

import { mentionedNames, mentionsIn, type Named } from "./names.ts";

export const EVERYONE_MENTION = "everyone";
export const ANYONE_MENTION = "anyone";

/** An agent the list can offer, and where it is when that is not this folder. */
export type Mentionable = Named & { where?: string };

/** Whether a name is one of the group mentions, so it names no single session. */
export function isGroupMention(name: string): boolean {
	return name === EVERYONE_MENTION || name === ANYONE_MENTION;
}

/** The word the room writes for the audience a message went to. */
export function audienceLabel(to: "all" | "any"): string {
	return to === "all" ? EVERYONE_MENTION : ANYONE_MENTION;
}

/** What each group mention does, under its name in the list. */
const GROUPS: Record<string, string> = {
	[EVERYONE_MENTION]: "every agent here gets it",
	[ANYONE_MENTION]: "the agent that fits it best takes it",
};

/** An `@` and the start of a name, right before the cursor. */
const TYPING_PATTERN = /(?:^|[\s([{<`])(@[a-z0-9-]*)$/i;

/**
 * The name being typed after an `@` right before the cursor, in lower case, or undefined when none is.
 */
export function typingMention(text: string): string | undefined {
	return TYPING_PATTERN.exec(text)?.[1]?.slice(1).toLowerCase();
}

/**
 * The agents a message goes to: "all" for `@everyone`, "any" for `@anyone`. Undefined when it
 * mentions no other agent, so it goes to yours.
 */
export function recipientsOf(
	names: ReadonlyMap<string, Named>,
	me: string | undefined,
	text: string,
): Named[] | "all" | "any" | undefined {
	const mentioned = mentionedNames(text);
	if (mentioned.includes(EVERYONE_MENTION)) return "all";
	if (mentioned.includes(ANYONE_MENTION)) return "any";
	const named = mentionsIn(names, text).filter((one) => one.session !== me);
	return named.length === 0 ? undefined : named;
}

/** Puts the other agents, `@everyone` and `@anyone` above pi's files in the list that opens after an `@`. */
export function completeMentions(
	current: AutocompleteProvider,
	others: () => readonly Mentionable[],
): AutocompleteProvider {
	function isMention(item: AutocompleteItem): boolean {
		if (isGroupMention(item.value.slice(1))) return true;
		return others().some((named) => item.value === `@${named.handle}`);
	}

	return {
		triggerCharacters: current.triggerCharacters,

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const typed = (lines[cursorLine] ?? "").slice(0, cursorCol).match(TYPING_PATTERN)?.[1];
			const files = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const agents = typed === undefined ? [] : mentionItems(others(), typed.slice(1));
			if (typed === undefined || agents.length === 0) return files;
			// Pi's files go below, unless pi read the word before the cursor differently.
			const below = files?.prefix === typed ? files.items : [];
			return { items: [...agents, ...below], prefix: typed };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!isMention(item) || !prefix.startsWith("@"))
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			const line = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const rest = line.slice(cursorCol);
			const after = rest.startsWith(" ") ? rest : ` ${rest}`;
			return {
				lines: lines.with(cursorLine, line.slice(0, start) + item.value + after),
				cursorLine,
				cursorCol: start + item.value.length + 1,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** The agents whose names match what follows the `@`, then `@everyone` and `@anyone`. None alone. */
function mentionItems(others: readonly Mentionable[], query: string): AutocompleteItem[] {
	if (others.length === 0) return [];
	const agents = fuzzyFilter([...others], query, (named) => named.handle).map((named) => ({
		value: `@${named.handle}`,
		label: `@${named.handle}`,
		description: named.where ?? "agent in this folder",
	}));
	const groups = fuzzyFilter([EVERYONE_MENTION, ANYONE_MENTION], query, (name) => name).map(
		(name) => ({
			value: `@${name}`,
			label: `@${name}`,
			description: GROUPS[name] ?? "",
		}),
	);
	return [...agents, ...groups];
}
