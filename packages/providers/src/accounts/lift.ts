// A provider with accounts is re-registered so the accounts own it: every way pi asks for auth answers
// with the account in use, and each stream injects it again so a failure can move to the next one. One
// provider keeps one model list. The auth methods of the native provider do the work, so this file
// never speaks OAuth.
import {
	defaultProviderAuthContext,
	lazyStream,
	type Api,
	type ApiStreamOptions,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Credential,
	type Model,
	type ModelAuth,
	type OAuthAuth,
	type OAuthCredential,
	type Provider,
	type ProviderAuth,
	type ProviderAuthInteraction,
	type ProviderEnv,
	type ProviderHeaders,
	type SimpleStreamOptions,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

import { classifyFailure, type Failure } from "../errors.ts";
import { needsRefresh, refreshAccount, type Renewal } from "./refresh.ts";

/** An account as a request sees it. */
export interface AccountCredential {
	id: string;
	credential: Credential;
}

/** The account the next request uses, and where a refreshed token is kept. */
export interface AccountSession {
	/** The account in use, or undefined once the provider has none left. */
	resolve(): AccountCredential | undefined;
	/** A subscription account, for when pi's copy needs a refresh and the one in use is a key. */
	subscription?(): AccountCredential | undefined;
	save(id: string, credential: Credential): void;
	/** The account to try after this one hit a limit, or undefined to surface the error. */
	afterLimit(currentId: string, detail: string): Promise<AccountCredential | undefined>;
	/** The credential was refused, so sign in again or try another account. */
	afterAuthFailure?(currentId: string, detail: string): Promise<AccountCredential | undefined>;
	/** Pi's own login just produced a credential; the feature keeps it under a name. */
	adopt?(credential: Credential): Promise<void>;
	/** A framed screen for a login, when the caller can draw one. */
	loginScreen?(
		label: string,
		signal: AbortSignal,
	): Promise<{ interaction: ProviderAuthInteraction; close(): void } | undefined>;
	/** The credential on disk now, in case another pi refreshed it since we read ours. */
	freshen?(id: string): Credential | undefined;
	/** The file the refresh takes across processes, when the caller shares one. */
	lockPath?(): string;
	/** The quota headers of a response, kept for the account that served it. */
	noteUsage?(id: string, headers: Record<string, string>): void;
	/** The account served a request, so a limit it had is over. */
	served?(id: string): void;
}

/** The native provider behind a lifted one, so lifting twice wraps the same object. */
const NATIVE = Symbol.for("pi-providers.accounts.native");

/** The provider a lifted one came from, or the provider itself. */
export function nativeOf(provider: Provider): Provider {
	return (provider as { [NATIVE]?: Provider })[NATIVE] ?? provider;
}

export function liftProvider(provider: Provider, session: AccountSession): Provider {
	// Every method is delegated by hand, not by spread: the native may keep methods on a prototype,
	// and a copied method would lose its `this`. One refresh runs per account at a time.
	const refreshing = new Map<string, Promise<OAuthCredential>>();
	const getAllModels = provider.getAllModels;
	const refreshModels = provider.refreshModels;
	const filterModels = provider.filterModels;
	const filterAllModels = provider.filterAllModels;
	const fetchDeferred = provider.fetchDeferred;
	const cancelDeferred = provider.cancelDeferred;
	const generateImages = provider.generateImages;
	const classify = provider.classify;

	const lifted: Provider = {
		id: provider.id,
		name: provider.name,
		...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
		...(provider.headers === undefined ? {} : { headers: provider.headers }),
		auth: liftedAuth(provider, session, refreshing),
		getModels: () => provider.getModels(),
		...(getAllModels === undefined ? {} : { getAllModels: () => getAllModels() }),
		...(refreshModels === undefined ? {} : { refreshModels: (context) => refreshModels(context) }),
		...(filterModels === undefined
			? {}
			: { filterModels: (models, credential) => filterModels(models, credential) }),
		...(filterAllModels === undefined
			? {}
			: { filterAllModels: (models, credential) => filterAllModels(models, credential) }),
		stream<T extends Api>(
			model: Model<T>,
			context: TranscriptContext,
			options?: ApiStreamOptions<T>,
		) {
			return accountStream(provider, session, refreshing, "stream", model, context, options);
		},
		streamSimple(model, context, options) {
			return accountStream(provider, session, refreshing, "streamSimple", model, context, options);
		},
		...(fetchDeferred === undefined
			? {}
			: { fetchDeferred: (model, handle, options) => fetchDeferred(model, handle, options) }),
		...(cancelDeferred === undefined
			? {}
			: { cancelDeferred: (model, handle, options) => cancelDeferred(model, handle, options) }),
		...(generateImages === undefined
			? {}
			: { generateImages: (model, context, options) => generateImages(model, context, options) }),
		...(classify === undefined
			? {}
			: { classify: (model, context, options) => classify(model, context, options) }),
	};
	Object.defineProperty(lifted, NATIVE, { value: provider, enumerable: false });
	return lifted;
}

type Options = StreamOptions;

function accountStream(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options?: Options,
): AssistantMessageEventStream {
	const first = session.resolve();
	const settled = options ?? {};
	return lazyStream(model, async () =>
		attempts(provider, session, refreshing, kind, model, context, settled, first),
	);
}

/**
 * A re-login or a move after an auth failure costs an attempt. A move after a limit does not: the
 * account that refused leaves the candidates, so those moves end when the accounts do.
 */
const MAX_ATTEMPTS = 3;

async function* attempts(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options: Options,
	first: AccountCredential | undefined,
): AsyncGenerator<AssistantMessageEvent> {
	let account = first;

	for (let attempt = 1; ;) {
		// Hold the events until something is visible: a retry on another account must not repeat a
		// message the caller already saw.
		const buffered: AssistantMessageEvent[] = [];
		let output = false;
		let failure: AssistantMessage | undefined;
		let thrown: unknown;
		try {
			// The auth resolution is inside the try too: a refresh that fails is an auth failure, and it
			// must be able to move to the next account like any other.
			// oxlint-disable-next-line no-await-in-loop -- an attempt starts only after the one before it.
			const withAuth = await authFor(provider, session, refreshing, account, model, options);
			const source = call(provider, kind, withAuth.model, context, {
				...withAuth.options,
				onResponse: noteUsage(withAuth.options.onResponse, session, account?.id),
			});

			// oxlint-disable-next-line no-await-in-loop -- a stream is read one event at a time.
			for await (const event of source) {
				if (isContent(event)) {
					if (!output) {
						output = true;
						yield* buffered;
						buffered.length = 0;
					}
					yield event;
					continue;
				}
				if (event.type === "error") failure = event.error;
				if (output) yield event;
				else buffered.push(event);
			}
		} catch (error) {
			thrown = error;
		}

		if (failure === undefined && thrown === undefined && account !== undefined)
			session.served?.(account.id);

		const why = output ? undefined : failureOf(failure, thrown, model.provider);
		if (why !== undefined && (why.kind === "usage" || attempt < MAX_ATTEMPTS)) {
			// oxlint-disable-next-line no-await-in-loop -- the answer comes from the user.
			const next = await moveOn(session, account?.id, why);
			if (next !== undefined) {
				if (why.kind !== "usage") attempt++;
				account = next;
				continue;
			}
		}

		yield* buffered;
		if (thrown !== undefined) throw thrown;
		return;
	}
}

/** The classified failure behind an attempt: the provider's own error, or what it threw. */
function failureOf(
	failed: AssistantMessage | undefined,
	thrown: unknown,
	provider: string,
): Failure | undefined {
	if (failed?.errorMessage !== undefined) return classifyFailure(failed.errorMessage, provider);
	return thrown === undefined ? undefined : classifyFailure(thrown, provider);
}

/** What the policy says after a failure: another account, a sign-in, or nothing. */
async function moveOn(
	session: AccountSession,
	accountId: string | undefined,
	failure: Failure,
): Promise<AccountCredential | undefined> {
	// Without an account there is nothing to move from, and the error is the provider's to show.
	if (accountId === undefined) return undefined;
	if (failure.kind === "usage") return await session.afterLimit(accountId, failure.message);
	if (failure.kind === "auth") return await session.afterAuthFailure?.(accountId, failure.message);
	return undefined;
}

function isContent(event: AssistantMessageEvent): boolean {
	return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

/** Pi hands the response headers here, so the account that served it keeps its quota current. */
function noteUsage(
	next: Options["onResponse"],
	session: AccountSession,
	accountId: string | undefined,
): Options["onResponse"] {
	return async (response, model) => {
		if (accountId !== undefined) session.noteUsage?.(accountId, response.headers);
		await next?.(response, model);
	};
}

/** The request auth for an attempt: the account's, or untouched once the provider has none. */
async function authFor(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	account: AccountCredential | undefined,
	model: Model<Api>,
	options: Options,
): Promise<{ model: Model<Api>; options: Options }> {
	if (account === undefined) return { model, options };
	const resolved = await resolveAuth(provider, session, refreshing, account, options.signal);
	return applyAuth(resolved, model, options);
}

function call(
	provider: Provider,
	kind: "stream" | "streamSimple",
	model: Model<Api>,
	context: TranscriptContext,
	options: Options,
): AssistantMessageEventStream {
	if (kind === "streamSimple")
		return provider.streamSimple(model, context, options as SimpleStreamOptions);
	return provider.stream(model, context, options as ApiStreamOptions<Api>);
}

interface ResolvedAuth {
	auth: ModelAuth;
	env?: ProviderEnv;
}

async function resolveAuth(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	account: AccountCredential,
	signal: AbortSignal | undefined,
): Promise<ResolvedAuth> {
	const abort = signal ?? new AbortController().signal;
	if (account.credential.type === "oauth") {
		const oauth = provider.auth.oauth;
		if (oauth === undefined) return { auth: {} };
		const fresh = await refreshToken(
			oauth,
			session,
			refreshing,
			account.id,
			account.credential,
			abort,
		);
		return { auth: await oauth.toAuth(fresh) };
	}

	const apiKey = provider.auth.apiKey;
	if (apiKey === undefined) return { auth: {} };
	const resolved = await apiKey.resolve({
		ctx: defaultProviderAuthContext(),
		credential: account.credential,
		signal: abort,
	});
	return resolved === undefined ? { auth: {} } : { auth: resolved.auth, env: resolved.env };
}

// One refresh per account is shared, so two requests cannot rotate the token twice.
async function refreshToken(
	oauth: OAuthAuth,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	accountId: string,
	credential: OAuthCredential,
	signal: AbortSignal,
): Promise<OAuthCredential> {
	if (!needsRefresh(credential)) return credential;

	const inFlight = refreshing.get(accountId);
	if (inFlight !== undefined) return await inFlight;

	const renewal: Renewal = {
		freshen: (id) => session.freshen?.(id),
		save: (id, fresh) => session.save(id, fresh),
	};
	const task = refreshAccount(oauth, renewal, accountId, credential, signal, session.lockPath?.());
	refreshing.set(accountId, task);
	try {
		return await task;
	} finally {
		refreshing.delete(accountId);
	}
}

function applyAuth(
	resolved: ResolvedAuth,
	model: Model<Api>,
	options: Options,
): { model: Model<Api>; options: Options } {
	const next: Options = { ...options };
	if (resolved.auth.apiKey === undefined) delete next.apiKey;
	else next.apiKey = resolved.auth.apiKey;

	const headers = mergeHeaders(options.headers, resolved.auth.headers);
	if (headers === undefined) delete next.headers;
	else next.headers = headers;

	if (resolved.env === undefined && options.env === undefined) delete next.env;
	else next.env = { ...options.env, ...resolved.env };

	return {
		model:
			resolved.auth.baseUrl === undefined ? model : { ...model, baseUrl: resolved.auth.baseUrl },
		options: next,
	};
}

function mergeHeaders(
	base: ProviderHeaders | undefined,
	override: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
	if (base === undefined && override === undefined) return undefined;
	const merged: ProviderHeaders = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lower = name.toLowerCase();
		for (const existing of Object.keys(merged)) {
			if (existing.toLowerCase() === lower) delete merged[existing];
		}
		merged[name] = value;
	}
	return merged;
}

// Pi resolves a request's auth from the credential it stored for the provider, before the stream runs.
// Every one of those paths answers with the account in use here, so a classifier, an image or a
// deferred call bills the same account a chat does, and pi never refreshes its own copy: when that
// copy expires, the refresh renews an account and hands pi the result. Pi keeps that copy only because
// it decides at startup, before any extension runs, which providers are logged in.
function liftedAuth(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
): ProviderAuth {
	const original = provider.auth.apiKey;
	const login = original?.login;
	const oauth = provider.auth.oauth;
	const auth: ProviderAuth = {
		apiKey: {
			name: original?.name ?? `${provider.name} accounts`,
			...(login === undefined
				? {}
				: { login: (interaction) => adopted(login, interaction, session, provider.name) }),
			// Reporting the account's own type keeps `isUsingOAuth` honest, which bills a subscription.
			async check(input) {
				const account = session.resolve();
				if (account !== undefined) return { type: account.credential.type, source: "account" };
				return original?.check?.(input);
			},
			async resolve(input) {
				const resolved = await authInUse(provider, session, refreshing, input.signal);
				if (resolved === undefined) return original?.resolve(input);
				return { ...resolved, source: "account" };
			},
		},
	};
	if (oauth !== undefined) {
		auth.oauth = {
			name: oauth.name,
			...(oauth.isSubscription === undefined ? {} : { isSubscription: oauth.isSubscription }),
			...(oauth.loginLabel === undefined ? {} : { loginLabel: oauth.loginLabel }),
			login: (interaction, options) =>
				adopted((next) => oauth.login(next, options), interaction, session, provider.name),
			async refresh(credential, signal) {
				const account = subscriptionOf(session);
				if (account === undefined) return await oauth.refresh(credential, signal);
				return await refreshToken(
					oauth,
					session,
					refreshing,
					account.id,
					account.credential,
					signal,
				);
			},
			async toAuth(credential) {
				const signal = new AbortController().signal;
				const resolved = await authInUse(provider, session, refreshing, signal);
				return resolved?.auth ?? (await oauth.toAuth(credential));
			},
		};
	}
	return auth;
}

/** The auth of the account in use, or undefined once the provider has none. */
async function authInUse(
	provider: Provider,
	session: AccountSession,
	refreshing: Map<string, Promise<OAuthCredential>>,
	signal: AbortSignal,
): Promise<ResolvedAuth | undefined> {
	const account = session.resolve();
	if (account === undefined) return undefined;
	return await resolveAuth(provider, session, refreshing, account, signal);
}

/** The OAuth account pi's copy is renewed from: the one in use, else any subscription. */
function subscriptionOf(
	session: AccountSession,
): { id: string; credential: OAuthCredential } | undefined {
	const candidates = [session.resolve(), session.subscription?.()];
	for (const account of candidates) {
		if (account?.credential.type === "oauth")
			return { id: account.id, credential: account.credential };
	}
	return undefined;
}

/** Runs a login on our framed screen when there is one, then lets the feature keep the credential. */
async function adopted<T extends Credential>(
	login: (interaction: ProviderAuthInteraction) => Promise<T>,
	interaction: ProviderAuthInteraction,
	session: AccountSession,
	label: string,
): Promise<T> {
	const screen = await session.loginScreen?.(label, interaction.signal);
	try {
		const credential = await login(screen?.interaction ?? interaction);
		await session.adopt?.(credential);
		return credential;
	} finally {
		screen?.close();
	}
}
