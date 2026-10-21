// Joining a provider to the session: which account a request uses, where a refreshed token goes, and
// what quota each account reported.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { loginScreen as openLogin } from "../ui/login.ts";
import type { Quota } from "../usage/quota.ts";
import { noteUsage, resetNote, usageOf, worstWindow } from "../usage/read.ts";
import type { AccountUsage, UsageMap } from "../usage/types.ts";
import { refreshStatus } from "./actions.ts";
import { activeAccount } from "./active.ts";
import { adoptAccount } from "./adopt.ts";
import { reason } from "./describe.ts";
import { type AccountCredential, liftProvider, nativeOf, type AccountSession } from "./lift.ts";
import type { Pins } from "./pins.ts";
import { afterAuthFailure, afterLimit } from "./policy.ts";
import { type Renewal, needsRefresh, refreshAccount } from "./refresh.ts";
import { accountsLockPath, type AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** What the session learns while it runs. */
export interface Watch {
	limited: Map<string, Set<string>>;
	/** The accounts you chose to stop on at a limit, which are not asked about again. */
	declined: Map<string, Set<string>>;
	usage: UsageMap;
	quota: Quota;
}

export function attachProvider(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string,
): void {
	// A pin with no account left behind it injects nothing, so re-registering would only cost a
	// model-registry rebuild.
	if (!store.has(providerId)) return;

	// `getProvider` returns the lifted provider once we registered one, so unwrap it before wrapping
	// again. After a `/reload` it returns the built-in one, which is unwrapped too.
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider === undefined) {
		scope.warn(`no provider "${providerId}", so its accounts do nothing`);
		return;
	}
	scope.registerProvider(
		liftProvider(nativeOf(provider), sessionFor(scope, store, pins, watch, ctx, providerId)),
	);
}

export function sessionFor(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string,
): AccountSession {
	// The turn and the tasks' call hit a limit together; they share one dialog and its answer.
	const deciding = new Map<string, Promise<AccountCredential | undefined>>();
	function once(
		key: string,
		decide: () => Promise<AccountCredential | undefined>,
	): Promise<AccountCredential | undefined> {
		const decision = deciding.get(key) ?? decide().finally(() => deciding.delete(key));
		deciding.set(key, decision);
		return decision;
	}
	return {
		resolve: () => requestOf(activeAccount(store, pins, providerId)),
		subscription: () =>
			requestOf(store.accounts(providerId).find((account) => account.credential.type === "oauth")),
		save: (id, credential) => void store.setCredential(providerId, id, credential),
		served: (id) => {
			watch.limited.get(providerId)?.delete(id);
			watch.declined.get(providerId)?.delete(id);
			store.clearError(providerId, id);
			store.markLimited(providerId, id, undefined);
		},
		adopt: (credential) => adoptAccount(scope, store, pins, ctx, providerId, credential),
		loginScreen: (label, signal) => openLogin(ctx, label, signal),
		freshen: (id) => renewalFor(store, providerId).freshen(id),
		lockPath: accountsLockPath,
		noteUsage: (id, headers) =>
			noteUsage(watch.usage, providerId, id, watch.quota.fromHeaders(providerId, headers)),
		afterLimit: (currentId, detail) =>
			once(`limit:${currentId}`, async () => {
				const reading = await readingFor(watch, store, ctx, providerId, currentId);
				const until = worstWindow(reading)?.window.resetsAt;
				if (until !== undefined) store.markLimited(providerId, currentId, until);
				return await afterLimit(
					scope,
					store,
					pins,
					ctx,
					providerId,
					currentId,
					withReset(detail, reading),
					watch.limited,
					watch.declined,
				);
			}),
		afterAuthFailure: (currentId, detail) =>
			once(`auth:${currentId}`, () =>
				afterAuthFailure(scope, store, pins, ctx, providerId, currentId, detail),
			),
	};
}

/** An account as a request carries it. */
function requestOf(account: Account | undefined): AccountCredential | undefined {
	return account === undefined ? undefined : { id: account.id, credential: account.credential };
}

function withReset(detail: string, usage: AccountUsage | undefined): string {
	const note = resetNote(usage);
	return note === undefined ? detail : `${detail} · ${note}`;
}

/** The reading already known: the live one, else the endpoint's. */
export function knownReading(
	watch: Watch,
	providerId: string,
	accountId: string,
): AccountUsage | undefined {
	return usageOf(watch.usage, providerId, accountId) ?? watch.quota.read(providerId, accountId);
}

/** Reads every account's plan of a provider, so the footer and the dialogs find their quota ready. */
export async function readPlans(
	store: AccountStore,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string | undefined,
): Promise<void> {
	if (!ctx.hasUI || providerId === undefined || !store.has(providerId)) return;
	await Promise.all(
		store
			.accounts(providerId)
			.map((account) => readingFor(watch, store, ctx, providerId, account.id)),
	);
}

/** Reads a provider's plans in the background, and draws the account again once they are in. */
export function showPlans(
	store: AccountStore,
	pins: Pins,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string | undefined,
): Promise<void> {
	return readPlans(store, watch, ctx, providerId).then(() => refreshStatus(store, pins, ctx));
}

/** The best reading for an account: the live one, else the endpoint's, fetched when there is none. */
export async function readingFor(
	watch: Watch,
	store: AccountStore,
	ctx: ExtensionContext,
	providerId: string,
	accountId: string,
): Promise<AccountUsage | undefined> {
	const known = knownReading(watch, providerId, accountId);
	if (known !== undefined) return known;
	const token = await planToken(store, ctx, providerId, accountId);
	return await watch.quota.ensure(providerId, accountId, token);
}

/** The token that can read a plan, refreshed when it has expired. */
async function planToken(
	store: AccountStore,
	ctx: ExtensionContext,
	providerId: string,
	accountId: string,
): Promise<string | undefined> {
	const account = store.accounts(providerId).find((entry) => entry.id === accountId);
	const credential = account?.credential;
	if (account === undefined || credential?.type !== "oauth") return undefined;
	if (!needsRefresh(credential)) return credential.access;

	const registered = ctx.modelRegistry.getProvider(providerId);
	const oauth = registered === undefined ? undefined : nativeOf(registered).auth.oauth;
	if (oauth === undefined) return undefined;
	try {
		const fresh = await refreshAccount(
			oauth,
			renewalFor(store, providerId),
			account.id,
			credential,
			new AbortController().signal,
			accountsLockPath(),
		);
		return fresh.access;
	} catch (error) {
		store.markError(providerId, account.id, "auth", reason(error));
		return undefined;
	}
}

/** The store side of a refresh: the newest copy, and where to save the result. */
function renewalFor(store: AccountStore, providerId: string): Renewal {
	return {
		freshen: (id) => {
			store.reload();
			return store.accounts(providerId).find((account) => account.id === id)?.credential;
		},
		save: (id, credential) => void store.setCredential(providerId, id, credential),
	};
}
