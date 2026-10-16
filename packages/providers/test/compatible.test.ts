import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AuthPrompt, ProviderAuthInteraction } from "@earendil-works/pi-ai";

import { chatModels, DEFAULT_CONTEXT, DEFAULT_OUTPUT } from "../src/compatible/catalog.ts";
import {
	baseUrlOf,
	COMPATIBLE_ID,
	credentialOf,
	type Endpoint,
	endpointsOf,
	idOf,
} from "../src/compatible/endpoints.ts";
import { type EndpointChanges, manageEndpoints } from "../src/compatible/login.ts";
import { endpointProvider } from "../src/compatible/provider.ts";
import { agentDirFixture } from "./helpers.ts";

const BASE = "https://api.deepinfra.com/v1/openai";
const DEEPINFRA: Endpoint = { id: "deepinfra", name: "DeepInfra", baseUrl: BASE, key: "sk-1" };

// Trimmed from DeepInfra's real `GET /models`.
const DEEPINFRA_MODELS = {
	data: [
		{
			id: "zai-org/GLM-5.3",
			metadata: {
				context_length: 1_048_576,
				max_tokens: 1_048_576,
				pricing: { input_tokens: 0.9, output_tokens: 4, cache_read_tokens: 0.2 },
				tags: ["chat", "prompt_cache", "reasoning"],
			},
		},
		{
			id: "zai-org/GLM-5.3-Flash",
			metadata: { context_length: 1_048_576, tags: ["chat", "vlm", "vision"] },
		},
		{ id: "google/nano-banana-pro", metadata: { tags: ["image-gen"] } },
	],
};

test("DeepInfra's catalog keeps its chat models with their limits and prices", () => {
	const models = chatModels(DEEPINFRA_MODELS, "deepinfra", BASE);
	expect(models.map((model) => model.id)).toEqual(["zai-org/GLM-5.3", "zai-org/GLM-5.3-Flash"]);
	const [glm, flash] = models;
	expect(glm?.contextWindow).toBe(1_048_576);
	expect(glm?.maxTokens).toBe(DEFAULT_OUTPUT);
	expect(glm?.reasoning).toBe(true);
	expect(glm?.cost).toEqual({ input: 0.9, output: 4, cacheRead: 0.2, cacheWrite: 0 });
	expect(glm?.baseUrl).toBe(BASE);
	expect(flash?.input).toEqual(["text", "image"]);
});

test("a catalog with only ids drops what does not chat and uses safe limits", () => {
	const models = chatModels(
		{ data: [{ id: "qwen2.5-coder" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }] },
		"local",
		"http://localhost:8000/v1",
	);
	expect(models.map((model) => model.id)).toEqual(["qwen2.5-coder"]);
	expect(models[0]?.contextWindow).toBe(DEFAULT_CONTEXT);
	expect(models[0]?.reasoning).toBe(false);
});

test("per-token prices become per-million prices", () => {
	const [model] = chatModels(
		{
			data: [
				{
					id: "a/b",
					context_length: 200_000,
					pricing: { prompt: "0.000003", completion: "0.000015" },
				},
			],
		},
		"router",
		"https://example.com/v1",
	);
	expect(model?.cost.input).toBeCloseTo(3);
	expect(model?.cost.output).toBeCloseTo(15);
	expect(model?.contextWindow).toBe(200_000);
});

test("a URL copied from a curl loses the path pi adds itself", () => {
	expect(baseUrlOf(`${BASE}/chat/completions`)).toBe(BASE);
	expect(baseUrlOf(`${BASE}/`)).toBe(BASE);
	expect(baseUrlOf("ftp://example.com")).toBeUndefined();
	expect(baseUrlOf("not a url")).toBeUndefined();
});

test("a name becomes a provider id", () => {
	expect(idOf("DeepInfra")).toBe("deepinfra");
	expect(idOf("  My vLLM box ")).toBe("my-vllm-box");
});

test("endpoints survive the trip through the credential", () => {
	const local: Endpoint = {
		id: "local",
		name: "Local",
		baseUrl: "http://localhost:8000/v1",
		key: "",
	};
	expect(endpointsOf(credentialOf([DEEPINFRA, local]))).toEqual([DEEPINFRA, local]);
	expect(endpointsOf({ type: "api_key", env: { "endpoint:x": "{broken" } })).toEqual([]);
});

function scripted(answers: string[]): ProviderAuthInteraction & { asked: AuthPrompt[] } {
	const asked: AuthPrompt[] = [];
	return {
		asked,
		signal: new AbortController().signal,
		prompt: async (prompt) => {
			asked.push(prompt);
			const answer = answers.shift();
			if (answer === undefined) throw new Error(`unexpected prompt: ${prompt.message}`);
			return answer;
		},
		notify: () => {},
	};
}

function changes(overrides: Partial<EndpointChanges> = {}): EndpointChanges & {
	addedIds: string[];
	removedIds: string[];
} {
	const addedIds: string[] = [];
	const removedIds: string[] = [];
	return {
		addedIds,
		removedIds,
		taken: () => false,
		added: (endpoint) => addedIds.push(endpoint.id),
		removed: (endpoint) => removedIds.push(endpoint.id),
		fetchModels: async (endpoint) => chatModels(DEEPINFRA_MODELS, endpoint.id, endpoint.baseUrl),
		env: async () => undefined,
		...overrides,
	};
}

test("the first login adds an endpoint from a pasted curl URL", async () => {
	const seen = changes();
	const credential = await manageEndpoints(
		[],
		scripted(["DeepInfra", `${BASE}/chat/completions`, "sk-1"]),
		seen,
	);
	expect(endpointsOf(credential)).toEqual([DEEPINFRA]);
	expect(seen.addedIds).toEqual(["deepinfra"]);
});

test("a later login can remove an endpoint", async () => {
	const local: Endpoint = {
		id: "local",
		name: "Local",
		baseUrl: "http://localhost:8000/v1",
		key: "",
	};
	const seen = changes();
	const credential = await manageEndpoints(
		[DEEPINFRA, local],
		scripted(["remove:deepinfra"]),
		seen,
	);
	expect(endpointsOf(credential)).toEqual([local]);
	expect(seen.removedIds).toEqual(["deepinfra"]);
});

test("adding the same name again replaces the endpoint", async () => {
	const credential = await manageEndpoints(
		[DEEPINFRA],
		scripted(["add", "DeepInfra", BASE, "sk-2"]),
		changes({ taken: () => true }),
	);
	expect(endpointsOf(credential)).toEqual([{ ...DEEPINFRA, key: "sk-2" }]);
});

test("a name another provider already uses is refused", async () => {
	const login = manageEndpoints(
		[],
		scripted(["OpenAI"]),
		changes({ taken: (id) => id === "openai" }),
	);
	await expect(login).rejects.toThrow("pi already has a provider called openai");
});

test("a key read from an unset variable fails before anything is saved", async () => {
	const seen = changes();
	const login = manageEndpoints([], scripted(["DeepInfra", BASE, "$DEEPINFRA_API_KEY"]), seen);
	await expect(login).rejects.toThrow("$DEEPINFRA_API_KEY is not set");
	expect(seen.addedIds).toEqual([]);
});

let fixture: ReturnType<typeof agentDirFixture>;
beforeEach(() => {
	fixture = agentDirFixture("pi-compatible-");
});
afterEach(() => fixture.restore());

function storeAuth(data: Record<string, unknown>): void {
	writeFileSync(join(fixture.dir, "auth.json"), JSON.stringify(data));
}

async function resolve(endpoint: Endpoint, credential?: { type: "api_key"; key?: string }) {
	const auth = endpointProvider(endpoint).auth.apiKey;
	return await auth?.resolve({
		ctx: {
			env: async (name) => (name === "DEEPINFRA_API_KEY" ? "sk-env" : undefined),
			fileExists: async () => false,
		},
		credential,
		signal: new AbortController().signal,
	});
}

test("an endpoint sends the key it was added with, to its own base URL", async () => {
	storeAuth({ [COMPATIBLE_ID]: credentialOf([DEEPINFRA]) });
	expect((await resolve(DEEPINFRA))?.auth).toEqual({ apiKey: "sk-1", baseUrl: BASE });
});

test("a key from its own /login wins over the one it was added with", async () => {
	storeAuth({ [COMPATIBLE_ID]: credentialOf([DEEPINFRA]) });
	const result = await resolve(DEEPINFRA, { type: "api_key", key: "sk-own" });
	expect(result?.auth.apiKey).toBe("sk-own");
});

test("a $NAME key is read from the environment on each request", async () => {
	const endpoint = { ...DEEPINFRA, key: "$DEEPINFRA_API_KEY" };
	storeAuth({ [COMPATIBLE_ID]: credentialOf([endpoint]) });
	expect((await resolve(endpoint))?.auth.apiKey).toBe("sk-env");
});

test("a removed endpoint stops resolving, so its models leave /model", async () => {
	storeAuth({ [COMPATIBLE_ID]: credentialOf([]) });
	expect(await resolve(DEEPINFRA)).toBeUndefined();
});
