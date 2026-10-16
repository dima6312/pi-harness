// Every endpoint lives in one pi credential, `openai-compatible`, as an `env` entry. The keys stay in
// pi's auth.json, and `/logout` of that entry removes them all.
import { isObject } from "@adeildo/pi-kit";
import type { ApiKeyCredential, AuthContext, Model } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

import { chatModels, type Completions } from "./catalog.ts";

export const COMPATIBLE_ID = "openai-compatible";

const PREFIX = "endpoint:";
const MODELS_TIMEOUT = 15_000;
const ENV_REFERENCE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;

export interface Endpoint {
	id: string;
	name: string;
	baseUrl: string;
	/** A literal key, `$NAME` for an environment variable, or empty for a server without one. */
	key: string;
}

export function endpointsOf(credential: unknown): Endpoint[] {
	if (!isObject(credential) || !isObject(credential.env)) return [];
	const endpoints: Endpoint[] = [];
	for (const [name, value] of Object.entries(credential.env)) {
		if (!name.startsWith(PREFIX) || typeof value !== "string") continue;
		const endpoint = decode(name.slice(PREFIX.length), value);
		if (endpoint !== undefined) endpoints.push(endpoint);
	}
	return endpoints;
}

// Read from the file on every call, so a change from another pi counts at once.
export function storedEndpoints(): Endpoint[] {
	return endpointsOf(readStoredCredential(COMPATIBLE_ID));
}

export function credentialOf(endpoints: readonly Endpoint[]): ApiKeyCredential {
	const env: Record<string, string> = {};
	for (const { id, name, baseUrl, key } of endpoints) {
		env[`${PREFIX}${id}`] = JSON.stringify({ name, baseUrl, key });
	}
	return { type: "api_key", env };
}

function decode(id: string, value: string): Endpoint | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (!isObject(parsed)) return undefined;
	const { name, baseUrl, key } = parsed;
	if (typeof name !== "string" || typeof baseUrl !== "string" || typeof key !== "string") {
		return undefined;
	}
	return { id, name, baseUrl, key };
}

export function idOf(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9.]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
}

// A URL copied from a curl ends in `/chat/completions`; pi adds that path itself.
export function baseUrlOf(input: string): string | undefined {
	const trimmed = input.trim();
	if (!URL.canParse(trimmed)) return undefined;
	const { protocol } = new URL(trimmed);
	if (protocol !== "http:" && protocol !== "https:") return undefined;
	return trimmed.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|models)$/, "");
}

export async function keyOf(key: string, env: AuthContext["env"]): Promise<string | undefined> {
	const variable = ENV_REFERENCE.exec(key.trim())?.[1];
	if (variable !== undefined) return await env(variable);
	return key === "" ? undefined : key;
}

export async function fetchModels(
	endpoint: Endpoint,
	key: string | undefined,
	signal: AbortSignal,
): Promise<Model<Completions>[]> {
	const response = await fetch(`${endpoint.baseUrl}/models`, {
		headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(MODELS_TIMEOUT)]),
	});
	if (!response.ok) {
		const detail = (await response.text()).trim().slice(0, 200);
		const suffix = detail === "" ? "" : `: ${detail}`;
		throw new Error(`${endpoint.baseUrl}/models answered ${response.status}${suffix}`);
	}
	return chatModels(await response.json(), endpoint.id, endpoint.baseUrl);
}
