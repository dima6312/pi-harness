// The betas an Anthropic request carries. Pi drops its own list the moment an extension sets the
// header, so every feature that needs one grows the payload's list instead, and each name appears
// once. The list comes back with the names ours added, so a payload that needed nothing goes on as
// the same object, which is what the caller reads as "no change".

export interface Betas {
	betas: string[];
	/** True when a name we asked for was not on the list yet. */
	added: boolean;
}

export function mergeBetas(existing: unknown, wanted: readonly string[]): Betas {
	const betas = Array.isArray(existing) ? existing.filter(isString) : [];
	let added = false;
	for (const beta of wanted) {
		if (betas.includes(beta)) continue;
		betas.push(beta);
		added = true;
	}
	return { betas, added };
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
