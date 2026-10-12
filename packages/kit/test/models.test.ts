import { expect, test } from "bun:test";

import { type ChatModel, modelsFor } from "../src/models.ts";

function model(id: string, price: number, provider = "anthropic"): ChatModel {
	return { id, provider, cost: { input: price, output: price } } as unknown as ChatModel;
}

const OPUS = model("opus", 15);
const HAIKU = model("haiku", 1);
const registry = {
	getAvailable: () => [OPUS, HAIKU, model("cheap-elsewhere", 0.1, "openai")],
	find: (provider: string, id: string) =>
		[OPUS, HAIKU].find((entry) => entry.provider === provider && entry.id === id),
};

test("auto is the cheapest model of the session's provider, and the session's model comes after", () => {
	expect(modelsFor("auto", registry, OPUS).map((entry) => entry.id)).toEqual(["haiku", "opus"]);
	expect(modelsFor("session", registry, OPUS).map((entry) => entry.id)).toEqual(["opus"]);
	expect(modelsFor("anthropic/haiku", registry, HAIKU).map((entry) => entry.id)).toEqual(["haiku"]);
	expect(modelsFor("auto", registry, undefined)).toEqual([]);
});
