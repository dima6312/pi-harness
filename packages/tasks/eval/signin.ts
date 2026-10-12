// Pi's models for the eval, with every Anthropic request signed by an account of the harness and
// billed to its plan.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { userAgent } from "../../providers/src/subscription/billing.ts";
import { billToPlan } from "../../providers/src/subscription/payload.ts";

const CLAUDE_CODE = "2.1.280";

/** Pi's models, with every Anthropic request signed by a harness account and billed to its plan. */
export async function signedIn(): Promise<ModelRegistry> {
	const runtime = await ModelRuntime.create({ authPath: join(homedir(), ".pi/agent/auth.json") });
	const signed = new ModelRegistry(runtime);
	const token = accountToken();
	const stream = signed.streamSimple.bind(signed);
	signed.streamSimple = (target, context, options) =>
		stream(target, context, {
			...options,
			apiKey: token,
			headers: { ...options?.headers, "user-agent": userAgent(CLAUDE_CODE) },
			onPayload: (payload) =>
				typeof payload === "object" && payload !== null
					? billToPlan(payload as Record<string, unknown>, CLAUDE_CODE)
					: undefined,
		});
	return signed;
}

interface Account {
	credential: { access?: string; expires?: number };
	health?: { limitedUntil?: number };
}

function accountToken(): string {
	const file = join(homedir(), ".pi/agent/extensions/pi-harness/accounts.json");
	const accounts = (
		JSON.parse(readFileSync(file, "utf8")) as { providers: { anthropic?: { accounts: Account[] } } }
	).providers.anthropic?.accounts;
	const now = Date.now();
	const usable = accounts?.find(
		(account) =>
			(account.health?.limitedUntil ?? 0) * 1000 < now &&
			(account.credential.expires ?? 0) > now + 60_000 &&
			account.credential.access !== undefined,
	);
	if (usable?.credential.access === undefined)
		throw new Error("no Anthropic account with a live token; open pi once to refresh them");
	return usable.credential.access;
}

/** A model by its `provider/id`, or an error that names it. */
export function modelNamed(registry: ModelRegistry, ref: string): Model<Api> {
	const [provider = "", ...rest] = ref.split("/");
	const model = registry.find(provider, rest.join("/"));
	if (model === undefined) throw new Error(`no model ${ref}`);
	return model;
}
