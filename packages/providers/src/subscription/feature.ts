import { defineFeature, isObject, setting, stringList } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { withClaudeCodeBetas } from "./betas.ts";
import { userAgent } from "./billing.ts";
import { CLAUDE_CODE_FEATURES, CLAUDE_CODE_VERSION, turnBetas } from "./claude-code.ts";
import { billToPlan } from "./payload.ts";

export const betas = setting({
	id: "subscription.betas",
	default: turnBetas(),
	decoder: stringList("anthropic-beta headers"),
	ui: {
		section: "Anthropic subscription",
		label: "Betas",
		description: "What an OAuth request asks for beside the betas pi works out for itself.",
		control: {
			type: "list",
			options: CLAUDE_CODE_FEATURES.map((feature) => ({
				value: feature.header,
				description: `${feature.name.replaceAll("_", " ")}: ${
					feature.turn
						? "on every turn of Claude Code"
						: "only in a case this harness does not mirror, so what it does here is unknown"
				}`,
			})),
		},
	},
});

export const subscription = defineFeature({
	id: "subscription",
	description: "Bill Anthropic OAuth requests to the Claude plan instead of extra usage",
	tab: "Providers",
	settings: [betas],
	setup(scope) {
		scope.on("before_provider_headers", (event, ctx) => {
			if (usesSubscription(ctx)) event.headers["user-agent"] = userAgent(CLAUDE_CODE_VERSION);
		});

		scope.on("before_provider_request", (event, ctx) => {
			if (!usesSubscription(ctx) || !isObject(event.payload)) return undefined;
			const billed = billToPlan(event.payload, CLAUDE_CODE_VERSION);
			if (billed === undefined) return undefined;
			return withClaudeCodeBetas(billed, betas.get(scope));
		});
	},
});

function usesSubscription(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	if (model === undefined || model.api !== "anthropic-messages") return false;
	return ctx.modelRegistry.isUsingOAuth(model);
}
