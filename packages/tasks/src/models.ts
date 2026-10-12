// `auto`: the cheapest model of the session's provider. The session's model is always the fallback.
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const AUTO = "auto";
export const SESSION = "session";

type Registry = Pick<ExtensionContext["modelRegistry"], "getAvailable" | "find">;

export function modelsFor(
	choice: string,
	registry: Registry,
	session: Model<Api> | undefined,
): Model<Api>[] {
	const chosen = chosenModel(choice, registry, session);
	const order = [chosen, session].filter((model): model is Model<Api> => model !== undefined);
	return order.filter(
		(model, index) => order.findIndex((other) => sameModel(other, model)) === index,
	);
}

function chosenModel(
	choice: string,
	registry: Registry,
	session: Model<Api> | undefined,
): Model<Api> | undefined {
	if (choice === SESSION) return session;
	if (choice === AUTO) return cheapest(registry, session);
	const [provider = "", ...rest] = choice.split("/");
	return registry.find(provider, rest.join("/"));
}

function cheapest(registry: Registry, session: Model<Api> | undefined): Model<Api> | undefined {
	if (session === undefined) return undefined;
	const priced = registry
		.getAvailable()
		.filter((model) => model.provider === session.provider && price(model) > 0);
	return priced.toSorted((left, right) => price(left) - price(right))[0] ?? session;
}

function price(model: Model<Api>): number {
	return model.cost.input + model.cost.output;
}

export function modelRef(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function sameModel(left: Model<Api>, right: Model<Api>): boolean {
	return left.provider === right.provider && left.id === right.id;
}
