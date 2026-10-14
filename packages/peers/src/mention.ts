// A message you type that mentions another agent goes to that agent and not to yours. `@name` sends
// it to one agent. `@everyone` asks all of them, and the one that fits best takes it. Pi also uses
// `@` to attach files, so only the name of an open session counts, and the list that opens after
// `@` shows the agents above the files.
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

import { mentionedNames, mentionsIn, type Named } from "./names.ts";

export const EVERYONE_MENTION = "everyone";

/** An `@` and the start of a name, right before the cursor. */
const TYPING_PATTERN = /(?:^|[\s([{<`])(@[a-z0-9-]*)$/i;

/**
 * The agents a message goes to, or "all" for `@everyone`. Undefined when it mentions no other
 * agent, so it goes to yours.
 */
export function recipientsOf(
	names: ReadonlyMap<string, Named>,
	me: string | undefined,
	text: string,
): Named[] | "all" | undefined {
	if (mentionedNames(text).includes(EVERYONE_MENTION)) return "all";
	const named = mentionsIn(names, text).filter((one) => one.session !== me);
	return named.length === 0 ? undefined : named;
}

/** Puts the other agents, and `@everyone`, above pi's files in the list that opens after an `@`. */
export function completeMentions(
	current: AutocompleteProvider,
	others: () => readonly Named[],
): AutocompleteProvider {
	function isMention(item: AutocompleteItem): boolean {
		if (item.value === `@${EVERYONE_MENTION}`) return true;
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

/** The agents whose names match what follows the `@`, then `@everyone`. None when you are alone. */
function mentionItems(others: readonly Named[], query: string): AutocompleteItem[] {
	if (others.length === 0) return [];
	const agents = fuzzyFilter([...others], query, (named) => named.handle).map((named) => ({
		value: `@${named.handle}`,
		label: `@${named.handle}`,
		description: "agent in this folder",
	}));
	const everyone = fuzzyFilter([EVERYONE_MENTION], query, (name) => name).map((name) => ({
		value: `@${name}`,
		label: `@${name}`,
		description: "every agent here, the best fit takes it",
	}));
	return [...agents, ...everyone];
}
