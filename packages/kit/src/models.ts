import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Control } from "./control.ts";

type Registry = Pick<ExtensionContext["modelRegistry"], "getAvailable" | "find">;
export type ChatModel = ReturnType<Registry["getAvailable"]>[number];

export const AUTO_MODEL = "auto";
export const SESSION_MODEL = "session";

export function modelsFor(
	choice: string,
	registry: Registry,
	session: ChatModel | undefined,
): ChatModel[] {
	const order = [chosenModel(choice, registry, session), session].filter(
		(model): model is ChatModel => model !== undefined,
	);
	return order.filter(
		(model, index) => order.findIndex((other) => sameModel(other, model)) === index,
	);
}

export function modelChoice(ctx: ExtensionContext): Control {
	return {
		type: "choice",
		options: [
			{ value: AUTO_MODEL, description: "the cheapest model of the session's provider" },
			{ value: SESSION_MODEL, description: "the model you are talking to" },
			...ctx.modelRegistry.getAvailable().map((entry) => ({ value: modelRef(entry) })),
		],
	};
}

export function modelRef(model: Pick<ChatModel, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

function chosenModel(
	choice: string,
	registry: Registry,
	session: ChatModel | undefined,
): ChatModel | undefined {
	if (choice === SESSION_MODEL) return session;
	if (choice === AUTO_MODEL) return cheapest(registry, session);
	const [provider = "", ...rest] = choice.split("/");
	return registry.find(provider, rest.join("/"));
}

function cheapest(registry: Registry, session: ChatModel | undefined): ChatModel | undefined {
	if (session === undefined) return undefined;
	const priced = registry
		.getAvailable()
		.filter((model) => model.provider === session.provider && price(model) > 0);
	return priced.toSorted((left, right) => price(left) - price(right))[0] ?? session;
}

function price(model: ChatModel): number {
	return model.cost.input + model.cost.output;
}

function sameModel(left: ChatModel, right: ChatModel): boolean {
	return left.provider === right.provider && left.id === right.id;
}
