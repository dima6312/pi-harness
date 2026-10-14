import { mergeBetas } from "@adeildo/pi-kit";

type Payload = Record<string, unknown>;

/**
 * Adds the betas from the settings to the ones pi computed, with pi's in front. Pi drops its own list
 * the moment an extension sets an `anthropic-beta` header, so this grows `payload.betas` instead.
 */
export function withClaudeCodeBetas(payload: Payload, wanted: readonly string[]): Payload {
	const { betas, added } = mergeBetas(payload.betas, wanted);
	return added ? { ...payload, betas } : payload;
}
