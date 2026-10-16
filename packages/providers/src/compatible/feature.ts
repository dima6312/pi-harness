import { defineFeature } from "@adeildo/pi-kit";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Completions } from "./catalog.ts";
import { type Endpoint, storedEndpoints } from "./endpoints.ts";
import { endpointProvider, endpointsProvider } from "./provider.ts";

export const compatible = defineFeature({
	id: "compatible",
	tab: "Providers",
	description: "Adds OpenAI-compatible endpoints through /login, with their models in /model",
	setup(scope) {
		let registry: ExtensionContext["modelRegistry"] | undefined;
		scope.onSessionStart((ctx) => {
			registry = ctx.modelRegistry;
		});

		function refreshEndpoints(): void {
			const providers = storedEndpoints().map((endpoint) => endpoint.id);
			if (registry === undefined || providers.length === 0) return;
			registry
				.refresh({ providers, allowNetwork: true })
				.catch((error: unknown) =>
					scope.warn(`reading the endpoints' models failed: ${String(error)}`),
				);
		}

		for (const endpoint of storedEndpoints()) scope.registerProvider(endpointProvider(endpoint));
		const changes = {
			taken: (id: string) => registry?.getProvider(id) !== undefined,
			added: (endpoint: Endpoint, models: readonly Model<Completions>[]) =>
				scope.registerProvider(endpointProvider(endpoint, models)),
			removed: (endpoint: Endpoint) => scope.unregisterProvider(endpoint.id),
		};
		scope.registerProvider(endpointsProvider(changes, refreshEndpoints));
	},
});
