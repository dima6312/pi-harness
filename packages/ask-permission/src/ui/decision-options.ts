import { tildify } from "@adeildo/pi-kit";

import type { FolderOffer } from "#core/answer.ts";

export interface Choice {
	key: string;
	decision: "allow" | "deny";
	always: boolean;
	/** Opens the offered folder. */
	open?: boolean;
	label: string;
	tone: "success" | "warning" | "error";
}

const YES: Omit<Choice, "key"> = {
	decision: "allow",
	always: false,
	label: "yes",
	tone: "success",
};
const ALWAYS: Omit<Choice, "key"> = {
	decision: "allow",
	always: true,
	label: "always yes",
	tone: "warning",
};
const DENY: Omit<Choice, "key"> = { decision: "deny", always: false, label: "deny", tone: "error" };

export const CHOICES: Choice[] = [
	{ ...YES, key: "1" },
	{ ...ALWAYS, key: "2" },
	{ ...DENY, key: "3" },
];

// Second, right under the plain yes: the answer the call most likely wants.
export function choicesFor(offer?: FolderOffer): Choice[] {
	if (offer === undefined) return CHOICES;
	const tone = offer.access === "read" ? "success" : "warning";
	return [
		{ ...YES, key: "1" },
		{ key: "2", decision: "allow", always: false, open: true, label: "", tone },
		{ ...ALWAYS, key: "3" },
		{ ...DENY, key: "4" },
	];
}

export function openLabel(offer: FolderOffer, folder: string): string {
	const shown = tildify(folder);
	return offer.access === "read"
		? `yes, and allow reads in ${shown}`
		: `yes, and add ${shown} to the workspace`;
}

export function fallbackChoices(offer?: FolderOffer): (Choice & { note: boolean })[] {
	const folder = offer?.folders[offer.suggested];
	return choicesFor(offer).flatMap((option, index) => {
		const label = option.open && offer && folder ? openLabel(offer, folder) : option.label;
		return [
			{ ...option, label, key: String(index * 2 + 1), note: false },
			{
				...option,
				key: String(index * 2 + 2),
				note: true,
				label: `${label}, ${option.decision === "allow" ? "with a note" : "with a reason"}`,
			},
		];
	});
}
