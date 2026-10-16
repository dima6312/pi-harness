import { isObject } from "@adeildo/pi-kit";
import type { Model } from "@earendil-works/pi-ai";

export type Completions = "openai-completions";

export const DEFAULT_CONTEXT = 128_000;
// Catalogs often report the context as the output limit, and endpoints refuse a request for that much.
export const DEFAULT_OUTPUT = 32_768;

const NOT_CHAT =
	/embed|rerank|whisper|tts|speech|transcri|dall-e|moderation|ocr|asr|flux|stable-diffusion|sdxl|image-gen/i;
const CHAT_TYPES = new Set(["chat", "language", "code"]);

export function chatModels(body: unknown, provider: string, baseUrl: string): Model<Completions>[] {
	const entries = isObject(body) && Array.isArray(body.data) ? body.data : [];
	return entries
		.map((entry) => chatModel(entry, provider, baseUrl))
		.filter((model) => model !== undefined)
		.toSorted((a, b) => a.id.localeCompare(b.id));
}

function chatModel(
	entry: unknown,
	provider: string,
	baseUrl: string,
): Model<Completions> | undefined {
	if (!isObject(entry) || typeof entry.id !== "string" || entry.id === "") return undefined;
	const meta = isObject(entry.metadata) ? entry.metadata : {};
	const tags = strings(meta.tags);
	if (!isChat(entry.id, tags, entry.type)) return undefined;

	const contextWindow =
		positive(meta.context_length) ??
		positive(entry.context_length) ??
		positive(entry.max_model_len) ??
		DEFAULT_CONTEXT;
	const reported = positive(meta.max_tokens);
	const maxTokens =
		reported !== undefined && reported < contextWindow
			? reported
			: Math.min(contextWindow, DEFAULT_OUTPUT);
	return {
		id: entry.id,
		name: entry.id,
		api: "openai-completions",
		provider,
		baseUrl,
		reasoning: tags.includes("reasoning"),
		input: tags.includes("vision") || tags.includes("vlm") ? ["text", "image"] : ["text"],
		cost: costOf(meta.pricing, entry.pricing),
		contextWindow,
		maxTokens,
	};
}

// DeepInfra tags its models and Together types them; a plain OpenAI catalog only has ids.
function isChat(id: string, tags: readonly string[], type: unknown): boolean {
	if (tags.length > 0) return tags.includes("chat");
	if (typeof type === "string") return CHAT_TYPES.has(type);
	return !NOT_CHAT.test(id);
}

// DeepInfra prices per million tokens, OpenRouter per token as strings.
function costOf(perMillion: unknown, perToken: unknown): Model<Completions>["cost"] {
	if (isObject(perMillion)) {
		return {
			input: amount(perMillion.input_tokens),
			output: amount(perMillion.output_tokens),
			cacheRead: amount(perMillion.cache_read_tokens),
			cacheWrite: 0,
		};
	}
	if (isObject(perToken)) {
		return {
			input: amount(perToken.prompt) * 1e6,
			output: amount(perToken.completion) * 1e6,
			cacheRead: amount(perToken.input_cache_read) * 1e6,
			cacheWrite: amount(perToken.input_cache_write) * 1e6,
		};
	}
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function amount(value: unknown): number {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
