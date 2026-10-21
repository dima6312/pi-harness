// The `/skill:name` pattern the skills feature expands and the look colors.
import { defineContract, type EventScope } from "../contract.ts";
import { stringList } from "../decode.ts";

/** The names a `/skill:` reference expands to, which the skills feature knows. */
export const SKILLS = defineContract<string[]>("skills:names", stringList("skill names"));

export const SKILL_REF = "/skill:";

/** Empty when no skills feature runs. */
export function skillNames(scope: EventScope): string[] {
	return SKILLS.current(scope) ?? [];
}

/** Group 1 is what came before, group 2 the name. */
function skillRefPattern(names: readonly string[]): RegExp | undefined {
	if (names.length === 0) return undefined;
	const alternatives = names
		.toSorted((left, right) => right.length - left.length)
		.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	return new RegExp(`(^|[\\s([{"'])${SKILL_REF}(${alternatives})(?![\\w-])`, "g");
}

const TYPING = /(?:^|[\s([{"'])(\/([\w.:-]*))$/;

export interface SkillQuery {
	/** What the completion replaces, slash included. */
	typed: string;
	query: string;
}

/** Undefined at the start of the message, where pi's own palette opens. */
export function skillQueryAt(
	lines: readonly string[],
	cursorLine: number,
	cursorCol: number,
): SkillQuery | undefined {
	const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
	const match = TYPING.exec(before);
	if (match === null) return undefined;
	const [, typed = "", query = ""] = match;
	if (cursorLine === 0 && before.trimStart() === typed) return undefined;
	return { typed, query };
}

export function referencedSkills(text: string, names: readonly string[]): string[] {
	const pattern = skillRefPattern(names);
	if (pattern === undefined) return [];
	const found: string[] = [];
	for (const prose of outsideCode(text)) {
		for (const match of prose.matchAll(pattern)) {
			const name = match[2];
			if (name !== undefined && !found.includes(name)) found.push(name);
		}
	}
	return found;
}

export function drawSkillRefs(
	text: string,
	names: readonly string[],
	draw: (name: string) => string,
): string {
	const pattern = skillRefPattern(names);
	if (pattern === undefined) return text;
	return splitCode(text)
		.map(({ code, part }) =>
			code
				? part
				: part.replace(pattern, (_whole, before: string, name: string) => `${before}${draw(name)}`),
		)
		.join("");
}

/** The text cut at inline code: `/skill:x` in backticks stays text. */
function splitCode(text: string): { code: boolean; part: string }[] {
	return text.split(/(`[^`]*`)/).map((part, index) => ({ code: index % 2 === 1, part }));
}

function outsideCode(text: string): string[] {
	return splitCode(text).flatMap(({ code, part }) => (code ? [] : [part]));
}
