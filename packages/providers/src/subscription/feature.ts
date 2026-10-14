import { defineFeature, isObject, pass, problem, setting, stringList } from "@adeildo/pi-kit";
import type { Decoder } from "@adeildo/pi-kit";
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
		description: "What an OAuth request asks for beside the betas pi computes.",
		control: {
			type: "list",
			options: CLAUDE_CODE_FEATURES.map((feature) => ({
				value: feature.header,
				description: feature.description,
			})),
		},
	},
});

/**
 * A value pi decides: the screen shows it and does not open an editor, because a decoder with no
 * control is read only. A settings file that disagrees is reported and ignored.
 */
function pinned(version: string): Decoder<string> {
	return {
		decode: (input, path) =>
			input === version
				? pass(version)
				: pass(version, [problem(path, `the harness pins this to ${version}`)]),
	};
}

export const mirrored = setting({
	id: "subscription.claudeCodeVersion",
	default: CLAUDE_CODE_VERSION,
	decoder: pinned(CLAUDE_CODE_VERSION),
	ui: {
		section: "Anthropic subscription",
		label: "Mirrored version",
		description:
			"The Claude Code release pi reports to Anthropic. The eval pins it, so there is nothing to set.",
	},
});

export const subscription = defineFeature({
	id: "subscription",
	description: "Bill Anthropic OAuth requests to the Claude plan instead of extra usage",
	tab: "Providers",
	settings: [mirrored, betas],
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
