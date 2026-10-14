type Payload = Record<string, unknown>;

/**
 * Adds the betas from the settings to the ones pi computed, with pi's in front. Pi drops its own list
 * the moment an extension sets an `anthropic-beta` header, so this grows `payload.betas` instead.
 */
export function withClaudeCodeBetas(payload: Payload, wanted: readonly string[]): Payload {
	const betas = Array.isArray(payload.betas) ? payload.betas.filter(isString) : [];
	const missing = wanted.filter((beta) => !betas.includes(beta));
	if (missing.length === 0) return payload;
	return { ...payload, betas: [...betas, ...missing] };
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
