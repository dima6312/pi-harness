// The accounts feature and its two entry points.
import { ACCOUNT_STATE, type AccountState, defineFeature, isObject } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Key } from "@earendil-works/pi-tui";

import { CLAUDE_CODE_VERSION } from "../subscription/claude-code.ts";
import { anthropicQuota } from "../usage/anthropic.ts";
import { Quota } from "../usage/quota.ts";
import { resetIn, windowsOf } from "../usage/read.ts";
import { refreshStatus } from "./actions.ts";
import { activeAccount } from "./active.ts";
import { attachProvider, knownReading, showPlans, type Watch } from "./attach.ts";
import {
	type Accounts,
	accountCount,
	loginProviders,
	manageAccounts,
	pickAccount,
} from "./dialogs.ts";
import { NAME, STATUS_KEY } from "./names.ts";
import { replay, type Pins } from "./pins.ts";
import { usageLimitLine } from "./policy.ts";
import { accountRows } from "./screen.ts";
import { onAuthFailure, onLimit } from "./settings.ts";
import { AccountStore } from "./store.ts";

export const accounts = defineFeature({
	id: "accounts",
	description: "Use more than one credential of the same provider",
	tab: "Providers",
	settings: [onLimit, onAuthFailure],
	setup(scope) {
		const store = new AccountStore();
		const pins: Pins = new Map();
		const watch: Watch = {
			limited: new Map(),
			declined: new Map(),
			usage: new Map(),
			quota: new Quota({
				anthropic: anthropicQuota(() => CLAUDE_CODE_VERSION),
			}),
		};

		const bundle: Accounts = { scope, store, pins, watch };
		let registry: ExtensionContext["modelRegistry"] | undefined;

		scope.screen.rows((ctx) => accountRows(scope, store, pins, ctx));
		// A model of another provider brings that provider's plans, so its quota shows before the first
		// answer instead of after it.
		scope.on("model_select", (event, ctx) => {
			refreshStatus(store, pins, ctx);
			showPlans(store, pins, watch, ctx, event.model.provider);
		});
		scope.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

		// Whoever draws the account in use asks for it on the spot, so it is never a frame old.
		scope.events.on(ACCOUNT_STATE, (data: unknown) => {
			if (!isObject(data) || typeof data.provider !== "string") return;
			data.state = inUse(watch, store, pins, data.provider);
		});

		// The line stops pi's own retry.
		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const providerId = event.message.provider;
			const account = activeAccount(store, pins, providerId);
			if (account === undefined) return;
			const note = resetIn(knownReading(watch, providerId, account.id));
			const text = usageLimitLine(event.message, account.label, note);
			if (text === undefined) return;
			return { message: { ...event.message, errorMessage: text } };
		});

		scope.onSessionStart((ctx) => {
			registry = ctx.modelRegistry;
			for (const warning of store.reload()) scope.warn(warning);
			pins.clear();
			watch.limited.clear();
			watch.declined.clear();
			watch.usage.clear();
			for (const [provider, account] of replay(ctx.sessionManager.getBranch())) {
				pins.set(provider, account);
			}
			for (const providerId of new Set([...store.providerIds(), ...pins.keys()])) {
				attachProvider(scope, store, pins, watch, ctx, providerId);
			}
			refreshStatus(store, pins, ctx);
			showPlans(store, pins, watch, ctx, ctx.model?.provider);
		});

		scope.registerShortcut(Key.alt("a"), {
			description: `${NAME}: switch the account of the current provider for this session`,
			handler: (ctx) => pickAccount(bundle, ctx),
		});

		scope.registerCommand("accounts", {
			description: `${NAME}: see, switch, rename, remove or add the accounts of a provider`,
			getArgumentCompletions: (prefix) => providerCompletions(registry, store, prefix),
			handler: (args, ctx) => manageAccounts(bundle, args, ctx),
		});
	},
});

/** The providers `/accounts` can take, those with accounts first. */
function providerCompletions(
	registry: ExtensionContext["modelRegistry"] | undefined,
	store: AccountStore,
	prefix: string,
): AutocompleteItem[] | null {
	if (registry === undefined) return null;
	const typed = prefix.trim().toLowerCase();
	const items = loginProviders(registry, store)
		.filter((id) => id.toLowerCase().startsWith(typed))
		.map((id) => {
			const name = registry.getProviderDisplayName(id);
			const count = store.accounts(id).length;
			return {
				value: id,
				label: id,
				description: count === 0 ? name : `${name}, ${accountCount(count)}`,
			};
		});
	return items.length === 0 ? null : items;
}

/** The account in use for a provider, with the windows it is spending. */
function inUse(
	watch: Watch,
	store: AccountStore,
	pins: Pins,
	providerId: string,
): AccountState | undefined {
	const account = activeAccount(store, pins, providerId);
	if (account === undefined) return undefined;
	return {
		provider: providerId,
		label: account.label,
		windows: windowsOf(knownReading(watch, providerId, account.id)),
		...(account.health?.lastError?.kind === "auth" ? { needsLogin: true } : {}),
	};
}
