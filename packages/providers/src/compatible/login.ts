import type { ApiKeyCredential, Model, ProviderAuthInteraction } from "@earendil-works/pi-ai";

import type { Completions } from "./catalog.ts";
import {
	baseUrlOf,
	COMPATIBLE_ID,
	credentialOf,
	type Endpoint,
	fetchModels,
	idOf,
	keyOf,
} from "./endpoints.ts";

export interface EndpointChanges {
	taken(id: string): boolean;
	added(endpoint: Endpoint, models: readonly Model<Completions>[]): void;
	removed(endpoint: Endpoint): void;
	fetchModels?: typeof fetchModels;
	env?: (name: string) => Promise<string | undefined>;
}

const ADD = "add";
const REMOVE = "remove:";

export async function manageEndpoints(
	current: readonly Endpoint[],
	interaction: ProviderAuthInteraction,
	changes: EndpointChanges,
): Promise<ApiKeyCredential> {
	const action = current.length === 0 ? ADD : await chooseAction(current, interaction);
	if (action.startsWith(REMOVE)) {
		const id = action.slice(REMOVE.length);
		const gone = current.find((endpoint) => endpoint.id === id);
		if (gone !== undefined) {
			changes.removed(gone);
			interaction.notify({ type: "info", message: `Removed ${gone.name}` });
		}
		return credentialOf(current.filter((endpoint) => endpoint.id !== id));
	}

	const endpoint = await askEndpoint(current, interaction, changes);
	interaction.notify({ type: "progress", message: `Reading the models of ${endpoint.name}` });
	const env = changes.env ?? (async (name: string) => process.env[name]);
	const key = await keyOf(endpoint.key, env);
	if (endpoint.key !== "" && key === undefined) {
		throw new Error(`${endpoint.key} is not set in this shell`);
	}
	const models = await (changes.fetchModels ?? fetchModels)(endpoint, key, interaction.signal);
	if (models.length === 0) throw new Error(`${endpoint.baseUrl}/models lists no chat model`);

	changes.added(endpoint, models);
	const count = models.length === 1 ? "1 chat model" : `${models.length} chat models`;
	interaction.notify({
		type: "info",
		message: `${endpoint.name}: ${count}, under ${endpoint.id} in /model`,
	});
	const kept = current.filter((entry) => entry.id !== endpoint.id);
	return credentialOf([...kept, endpoint]);
}

async function chooseAction(
	current: readonly Endpoint[],
	interaction: ProviderAuthInteraction,
): Promise<string> {
	return await interaction.prompt({
		type: "select",
		message: "OpenAI-compatible endpoints",
		options: [
			{ id: ADD, label: "Add an endpoint" },
			...current.map((endpoint) => ({
				id: `${REMOVE}${endpoint.id}`,
				label: `Remove ${endpoint.name}`,
				description: endpoint.baseUrl,
			})),
		],
	});
}

async function askEndpoint(
	current: readonly Endpoint[],
	interaction: ProviderAuthInteraction,
	changes: EndpointChanges,
): Promise<Endpoint> {
	const name = (
		await interaction.prompt({ type: "text", message: "Name", placeholder: "DeepInfra" })
	).trim();
	const id = idOf(name);
	if (id === "") throw new Error("The name needs a letter or a digit");
	const replacing = current.some((endpoint) => endpoint.id === id);
	if (id === COMPATIBLE_ID || (!replacing && changes.taken(id))) {
		throw new Error(`pi already has a provider called ${id}; pick another name`);
	}

	const url = await interaction.prompt({
		type: "text",
		message: "Base URL",
		placeholder: "https://api.deepinfra.com/v1/openai",
	});
	const baseUrl = baseUrlOf(url);
	if (baseUrl === undefined) throw new Error(`${url.trim()} is not an http or https URL`);

	const key = await interaction.prompt({
		type: "secret",
		message: "API key, $NAME to read it from the environment, or empty for none",
	});
	return { id, name, baseUrl, key: key.trim() };
}
