import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type { Completions } from "./catalog.ts";
import {
	COMPATIBLE_ID,
	type Endpoint,
	endpointsOf,
	fetchModels,
	keyOf,
	storedEndpoints,
} from "./endpoints.ts";
import { type EndpointChanges, manageEndpoints } from "./login.ts";

// Sent to a server that takes no key, since the OpenAI client refuses to go without one.
const NO_KEY = "none";

// Pi refreshes this provider from the network right after its login saves the credential. That is
// the first moment a new endpoint resolves its key, so the endpoints fetch and persist their models then.
export function endpointsProvider(
	changes: EndpointChanges,
	refreshEndpoints: () => void,
): Provider<Completions> {
	return createProvider<Completions>({
		id: COMPATIBLE_ID,
		name: "OpenAI-compatible endpoint",
		models: [],
		api: openAICompletionsApi(),
		fetchModels: async () => {
			refreshEndpoints();
			return [];
		},
		auth: {
			apiKey: {
				name: "OpenAI-compatible endpoint",
				login: async (interaction) =>
					await manageEndpoints(storedEndpoints(), interaction, changes),
				resolve: async ({ credential }) => {
					const count = endpointsOf(credential).length;
					if (count === 0) return undefined;
					return { auth: {}, source: count === 1 ? "1 endpoint" : `${count} endpoints` };
				},
			},
		},
	});
}

export function endpointProvider(
	endpoint: Endpoint,
	models: readonly Model<Completions>[] = [],
): Provider<Completions> {
	return createProvider<Completions>({
		id: endpoint.id,
		name: endpoint.name,
		baseUrl: endpoint.baseUrl,
		models,
		api: openAICompletionsApi(),
		fetchModels: async ({ credential, signal }) =>
			await fetchModels(
				endpoint,
				credential?.type === "api_key" ? credential.key : undefined,
				signal,
			),
		auth: {
			apiKey: {
				name: `${endpoint.name} API key`,
				login: async (interaction) => ({
					type: "api_key",
					key: await interaction.prompt({ type: "secret", message: `${endpoint.name} API key` }),
				}),
				resolve: async ({ ctx, credential }) => {
					const stored = storedEndpoints().find((entry) => entry.id === endpoint.id);
					if (stored === undefined) return undefined;
					const own = credential?.key;
					if (own !== undefined && own !== "") {
						return { auth: { apiKey: own, baseUrl: stored.baseUrl }, source: "/login" };
					}
					const key = await keyOf(stored.key, ctx.env);
					if (stored.key !== "" && key === undefined) return undefined;
					return {
						auth: { apiKey: key ?? NO_KEY, baseUrl: stored.baseUrl },
						source: stored.key.startsWith("$") ? stored.key : COMPATIBLE_ID,
					};
				},
			},
		},
	});
}
