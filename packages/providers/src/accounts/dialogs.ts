// The picker behind Alt+A and the list behind /accounts.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential, Provider } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	type AccountRow,
	type AccountState,
	type AccountsChoice,
	type AccountsListing,
	describeState,
	showAccounts,
} from "../ui/accounts.ts";
import { pick, type PickOption } from "../ui/picker.ts";
import { timeLeft, windowsOf } from "../usage/read.ts";
import type { AccountUsage } from "../usage/types.ts";
import {
	type AccountsOf,
	askName,
	refreshStatus,
	removeAccount,
	removeQuestion,
	renameAccount,
	saveAccount,
	useAccount,
} from "./actions.ts";
import { activeAccount } from "./active.ts";
import { attachProvider, knownReading, readPlans, showPlans, type Watch } from "./attach.ts";
import { reason } from "./describe.ts";
import { loginFor } from "./interaction.ts";
import { nativeOf } from "./lift.ts";
import { kindText, login, loginMethods, type LoginMethod, piLogin } from "./login.ts";
import { LOGIN_KEY, NAME } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import { signInAgain } from "./policy.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** Everything the dialogs share. */
export interface Accounts {
	scope: FeatureScope;
	store: AccountStore;
	pins: Pins;
	watch: Watch;
}

type Registry = ExtensionContext["modelRegistry"];

/** Alt+A: the account of the current provider, pinned for the session. */
export async function pickAccount(accounts: Accounts, ctx: ExtensionContext): Promise<void> {
	const { scope, store, pins, watch } = accounts;
	if (!ctx.hasUI) {
		scope.warn("no dialog to pick an account");
		return;
	}

	const providerId = ctx.model?.provider;
	if (providerId === undefined) {
		ctx.ui.notify(`${NAME}: no model selected`, "warning");
		return;
	}
	const provider = ctx.modelRegistry.getProviderDisplayName(providerId);
	const entries = store.accounts(providerId);
	if (entries.length === 0) {
		ctx.ui.notify(`${NAME}: ${provider} has no accounts yet. /accounts adds one`, "info");
		return;
	}

	const current = activeAccount(store, pins, providerId)?.id;
	const theme = ctx.ui.theme;
	const options: PickOption[] = entries.map((account) => {
		const kind = theme.fg("dim", `(${kindText(account.credential.type)})`);
		const here = account.id === current ? ` ${theme.fg("success", "✓")}` : "";
		const label = `${account.label} ${kind}${here}`;
		const usage = knownReading(watch, providerId, account.id);
		const description = describeState(theme, stateOf(account, usage, false));
		return description === "" ? { label } : { label, description };
	});

	const picked = await pick(ctx, `Account for ${provider}`, options);
	const choice = entries[options.findIndex((option) => option.label === picked)];
	if (choice === undefined) return;
	pin(scope, pins, providerId, choice.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${provider} uses ${choice.label}`, "info");
}

/**
 * /accounts: the accounts of a provider, the current model's unless one is named. Enter uses one,
 * here and in the sessions that start after; the list renames, removes and adds them too.
 */
export async function manageAccounts(
	accounts: Accounts,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	const { scope, store, pins, watch } = accounts;
	if (!ctx.hasUI) {
		scope.warn("no dialog to manage accounts");
		return;
	}

	const providerId = args.trim() || ctx.model?.provider || (await pickProvider(store, ctx));
	if (providerId === undefined) return;
	if (ctx.modelRegistry.getProvider(providerId) === undefined) {
		ctx.ui.notify(`${NAME}: no provider "${providerId}"`, "error");
		return;
	}
	const provider = ctx.modelRegistry.getProviderDisplayName(providerId);
	const of: AccountsOf = { pi: scope, store, pins, providerId };

	let reading = true;
	const ready = readPlans(store, watch, ctx, providerId).finally(() => {
		reading = false;
	});
	const listing: AccountsListing = {
		provider,
		rows: () =>
			store.accounts(providerId).map((account) => rowOf(accounts, providerId, account, reading)),
		empty: emptyText(providerId, provider),
		rename: (id, label) => renameAccount(of, ctx, id, label),
		remove: (id) => removeAccount(of, ctx, id),
		removeQuestion: (row) =>
			removeQuestion(provider, row.label, store.accounts(providerId).length === 1),
	};

	const choice =
		ctx.mode === "tui" && typeof ctx.ui.custom === "function"
			? await showAccounts(ctx, listing, ready)
			: await plainList(ctx, listing);
	if (choice === undefined) return;
	if (choice.kind === "add") {
		await addAccount(accounts, providerId, ctx);
		return;
	}

	const account = store.accounts(providerId).find((entry) => entry.id === choice.id);
	if (account === undefined) return;
	if (
		choice.kind === "signIn" &&
		(await signInAgain(store, ctx, providerId, account)) === undefined
	)
		return;
	useAccount(of, ctx, account.id);
	ctx.ui.notify(`${NAME}: ${provider} uses ${account.label}`, "info");
}

/** A host without our frame gets the list as a plain select: use one, or add one. */
async function plainList(
	ctx: ExtensionContext,
	listing: AccountsListing,
): Promise<AccountsChoice | undefined> {
	const rows = listing.rows();
	const add = "Add an account";
	const labels = rows.map((row) => (row.inUse ? `${row.label} (in use)` : row.label));
	const picked = await pick(ctx, `${listing.provider} accounts`, [...labels, add]);
	if (picked === add) return { kind: "add" };
	const row = rows[labels.indexOf(picked ?? "")];
	return row === undefined ? undefined : { kind: "use", id: row.id };
}

/** One account as the list draws it. */
function rowOf(
	accounts: Accounts,
	providerId: string,
	account: Account,
	reading: boolean,
): AccountRow {
	const { store, pins, watch } = accounts;
	const usage = knownReading(watch, providerId, account.id);
	const readable = reading && account.credential.type === "oauth" && watch.quota.reads(providerId);
	return {
		id: account.id,
		label: account.label,
		kind: kindText(account.credential.type),
		inUse: activeAccount(store, pins, providerId)?.id === account.id,
		state: stateOf(account, usage, readable),
	};
}

/** What a row says: the account's own trouble first, else how its plan stands. */
function stateOf(
	account: Account,
	usage: AccountUsage | undefined,
	reading: boolean,
): AccountState {
	if (account.health?.lastError?.kind === "auth") return { kind: "signIn" };
	const windows = windowsOf(usage);
	if (windows.length > 0) return { kind: "quota", windows };
	if (reading) return { kind: "reading" };
	const left = timeLeft(account.health?.limitedUntil ?? 0);
	return left === undefined ? { kind: "quiet" } : { kind: "spent", resetsIn: left };
}

/** What an empty list says, which mentions pi's own login when there is one to bring along. */
function emptyText(providerId: string, provider: string): string {
	const existing = piLogin(providerId);
	if (existing === undefined) return `No ${provider} accounts yet.`;
	const kind = kindText(existing.type);
	return `No ${provider} accounts yet. Adding one keeps your current ${kind} login as an account too.`;
}

/**
 * Names a new credential and runs the provider's own login. The first account makes the provider
 * ours, so pi's own login comes along under a name of its own: from then on only accounts are read.
 */
export async function addAccount(
	accounts: Accounts,
	providerId: string,
	ctx: ExtensionContext,
): Promise<void> {
	const { scope, store, pins, watch } = accounts;
	const registered = ctx.modelRegistry.getProvider(providerId);
	if (registered === undefined) {
		ctx.ui.notify(`${NAME}: no provider "${providerId}"`, "error");
		return;
	}
	const provider = ctx.modelRegistry.getProviderDisplayName(providerId);
	// This flow keeps the credential itself, so the login runs on the provider underneath: the lifted
	// one adopts what its login returns, which would name and add the account a second time.
	const method = await pickMethod(ctx, nativeOf(registered), provider);
	if (method === undefined) return;

	const first = !store.has(providerId);
	const carried = first ? await namePiLogin(ctx, providerId, provider) : undefined;
	const suggestion = suggestName(store, providerId, provider, carried?.label);
	const label = await askName(ctx, `Name the new ${provider} account`, suggestion);

	const session = await loginFor(ctx, provider, new AbortController().signal);
	try {
		const credential = await login(method, session.interaction);
		if (carried !== undefined) {
			const kept = saveAccount(ctx, store, providerId, carried.label, carried.credential);
			if (kept === undefined) return;
		}
		const added = saveAccount(ctx, store, providerId, label, credential);
		if (added === undefined) return;
		useAccount({ pi: scope, store, pins, providerId }, ctx, added.id);
		// The first account of a provider was not attached at session start, so attach it now.
		if (first) attachProvider(scope, store, pins, watch, ctx, providerId);
		ctx.ui.notify(`${NAME}: ${provider} now uses ${label}`, "info");
		void showPlans(store, pins, watch, ctx, providerId);
	} catch (error) {
		ctx.ui.notify(`${NAME}: ${reason(error)}`, "error");
	} finally {
		session.close();
		ctx.ui.setStatus(LOGIN_KEY, undefined);
	}
}

/** Pi's own login of a provider, with the name it keeps as an account, when there is one. */
async function namePiLogin(
	ctx: ExtensionContext,
	providerId: string,
	provider: string,
): Promise<{ label: string; credential: Credential } | undefined> {
	const credential = piLogin(providerId);
	if (credential === undefined) return undefined;
	const title = `Name the ${provider} ${kindText(credential.type)} login you already have`;
	return { label: await askName(ctx, title, provider), credential };
}

/** The provider's name for its first account, then the same name numbered. */
function suggestName(
	store: AccountStore,
	providerId: string,
	provider: string,
	alongside: string | undefined,
): string {
	const taken = new Set(store.accounts(providerId).map((account) => account.label));
	if (alongside !== undefined) taken.add(alongside);
	let candidate = provider;
	for (let number = 2; taken.has(candidate); number++) candidate = `${provider} ${number}`;
	return candidate;
}

/** The providers a login can add an account to, those with accounts first. */
export function loginProviders(registry: Registry, store: AccountStore): string[] {
	const ids = new Set(registry.getAll().map((model) => model.provider));
	return [...ids]
		.filter((id) => {
			const provider = registry.getProvider(id);
			return provider !== undefined && loginMethods(nativeOf(provider)).length > 0;
		})
		.toSorted(
			(a, b) =>
				store.accounts(b).length - store.accounts(a).length ||
				registry.getProviderDisplayName(a).localeCompare(registry.getProviderDisplayName(b)),
		);
}

/** How many accounts a provider has, as a picker says it. */
export function accountCount(count: number): string {
	return `${count} account${count === 1 ? "" : "s"}`;
}

/** The provider to manage, each with what it has. */
async function pickProvider(
	store: AccountStore,
	ctx: ExtensionContext,
): Promise<string | undefined> {
	const ids = loginProviders(ctx.modelRegistry, store);
	if (ids.length === 0) {
		ctx.ui.notify(`${NAME}: no provider offers a login`, "warning");
		return undefined;
	}
	const options: PickOption[] = ids.map((id) => {
		const label = ctx.modelRegistry.getProviderDisplayName(id);
		const count = store.accounts(id).length;
		if (count > 0) return { label, description: accountCount(count) };
		return piLogin(id) === undefined ? { label } : { label, description: "logged in" };
	});
	const picked = await pick(ctx, "Accounts for", options);
	return ids[options.findIndex((option) => option.label === picked)];
}

async function pickMethod(
	ctx: ExtensionContext,
	provider: Provider,
	name: string,
): Promise<LoginMethod | undefined> {
	const methods = loginMethods(provider);
	if (methods.length === 0) {
		ctx.ui.notify(`${NAME}: ${name} has no login method`, "warning");
		return undefined;
	}
	if (methods.length === 1) return methods[0];

	const labels = methods.map((method) => method.label);
	const picked = await pick(ctx, `How to sign in to ${name}`, labels);
	return methods.find((method) => method.label === picked);
}
