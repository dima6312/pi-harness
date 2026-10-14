import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import {
	createAssistantMessageEventStream,
	type Credential,
	type OAuthCredential,
	type Provider,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "../src/accounts/active.ts";
import { sessionFor, type Watch } from "../src/accounts/attach.ts";
import { type Accounts, pickAccount } from "../src/accounts/dialogs.ts";
import { accounts } from "../src/accounts/feature.ts";
import { nativeOf } from "../src/accounts/lift.ts";
import type { Pins } from "../src/accounts/pins.ts";
import { afterAuthFailure, afterLimit, usageLimitLine } from "../src/accounts/policy.ts";
import { onAuthFailure, onLimit } from "../src/accounts/settings.ts";
import { AccountStore } from "../src/accounts/store.ts";
import { anthropicQuota } from "../src/usage/anthropic.ts";
import { Quota } from "../src/usage/quota.ts";
import { agentDirFixture } from "./helpers.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const OTHER: Credential = { type: "api_key", key: "k" };
const WINDOW = `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit."}}`;

let dir: string;
let restore: () => void;

beforeEach(() => {
	const fixture = agentDirFixture("pi-accounts-feature-");
	dir = fixture.dir;
	restore = fixture.restore;
});

afterEach(() => restore());

function native(): Provider {
	return {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => createAssistantMessageEventStream(),
	};
}

test("a session lifts every provider that has accounts", async () => {
	new AccountStore().add("anthropic", "personal", OAUTH);

	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	const ctx = fakeContext([], true, {
		modelRegistry: { getProvider: (id: string) => (id === "anthropic" ? provider : undefined) },
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	expect(captured).toHaveLength(1);
	expect(nativeOf(captured[0] as Provider)).toBe(provider);
});

test("a provider without accounts is left alone", async () => {
	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const ctx = fakeContext([], true, {
		modelRegistry: { getProvider: () => native() },
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	expect(captured).toHaveLength(0);
});

test("adding the first account lifts the provider and pins it", async () => {
	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => ({ type: "oauth", access: "a", refresh: "r", expires: 0 }),
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const ctx = fakeContext([], true, {
		ui: {
			notify: () => {},
			setStatus: () => {},
			input: async () => "work",
			select: async (_title: string, options: string[]) => options.at(-1),
		},
		modelRegistry: {
			getProvider: () => provider,
			getProviderDisplayName: () => "Anthropic",
			getAll: () => [{ provider: "anthropic", id: "claude" }],
		},
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);
	expect(captured).toHaveLength(0);

	const handler = fake.commands.get("accounts")?.handler;
	if (handler === undefined) throw new Error("no accounts command");
	await handler("anthropic", ctx as never);

	expect(new AccountStore().has("anthropic")).toBe(true);
	expect(captured).toHaveLength(1);
	expect(nativeOf(captured[0] as Provider)).toBe(provider);
});

test("adding to a lifted provider keeps one account, not two", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);

	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => ({ type: "oauth", access: "b", refresh: "r2", expires: 0 }),
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const asked: string[] = [];
	const ctx = fakeContext([], true, {
		ui: {
			notify: () => {},
			setStatus: () => {},
			input: async () => "labora",
			select: async (title: string, options: string[]) => {
				asked.push(title);
				// The list closes on its last row, which adds an account.
				return options.at(-1);
			},
		},
		modelRegistry: {
			// Once the feature lifts it, the registry hands back the lifted provider.
			getProvider: () => captured[0] ?? provider,
			getProviderDisplayName: () => "Anthropic",
			getAll: () => [{ provider: "anthropic", id: "claude" }],
		},
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);
	expect(captured).toHaveLength(1);

	const handler = fake.commands.get("accounts")?.handler;
	if (handler === undefined) throw new Error("no accounts command");
	await handler("anthropic", ctx as never);

	// The lifted login would adopt the credential, and this flow would add it again.
	expect(asked).toEqual(["Anthropic accounts"]);
	expect(new AccountStore().accounts("anthropic").map((account) => account.label)).toEqual([
		"personal",
		"labora",
	]);
});

test("the session pin overrides the store's choice, and the first account stands in for none", () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const work = store.accounts("anthropic").at(-1);
	const pins: Pins = new Map([["anthropic", work?.id ?? ""]]);

	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OTHER);
	pins.delete("anthropic");
	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OAUTH);
	store.setActive("anthropic", work?.id);
	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OTHER);
	// A pin on an account that was removed falls back too.
	pins.set("anthropic", "gone");
	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OAUTH);
	expect(activeAccount(store, pins, "openai")).toBeUndefined();
});

test("after a limit, ask switches and pins, and stop keeps the error", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const shown: string[] = [];
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				shown.push(...options);
				return options[0];
			},
		},
	});

	const moved = await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429");
	expect(moved?.id).toBe(work.id);
	expect(pins.get("anthropic")).toBe(work.id);
	expect(shown[0]).toContain("Switch to work");

	scope.settings.set(onLimit, "stop");
	expect(await afterLimit(scope, store, pins, ctx, "anthropic", work.id, "429")).toBeUndefined();
});

test("a limit lists every other account, the spent ones last, and switches to the one picked", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	store.add("anthropic", "side", OTHER);
	store.add("anthropic", "spare", OTHER);
	const [personal, work, side, spare] = store.accounts("anthropic");
	if (personal === undefined || work === undefined || side === undefined || spare === undefined)
		throw new Error("no accounts");
	store.markLimited("anthropic", work.id, Math.floor(Date.now() / 1000) + 7200);
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const limited = new Map<string, Set<string>>();
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const shown: string[][] = [];
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				shown.push(options);
				return options[1];
			},
		},
	});

	const moved = await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429", limited);
	expect(shown[0]?.slice(0, 3)).toEqual([
		"Switch to side",
		"Switch to spare",
		"Switch to work (limited, resets in 2h)",
	]);
	expect(moved?.id).toBe(spare.id);
	expect(pins.get("anthropic")).toBe(spare.id);

	await afterLimit(scope, store, pins, ctx, "anthropic", spare.id, "429", limited);
	expect(shown[1]?.slice(0, 2)).toEqual([
		"Switch to side",
		"Switch to work (limited, resets in 2h)",
	]);
});

test("asking always turns the policy into switch", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_t: string, options: string[]) => options[1],
		},
	});

	await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429");
	expect(onLimit.get(scope)).toBe("switch");
	expect(pins.get("anthropic")).toBe(work.id);
});

test("after you stop on an account at its limit, its next limits fail without asking again", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal] = store.accounts("anthropic");
	if (personal === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const limited = new Map<string, Set<string>>();
	const declined = new Map<string, Set<string>>();
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	let asked = 0;
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				asked += 1;
				return options.at(-1);
			},
		},
	});
	const limit = () =>
		afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429", limited, declined);

	expect(await limit()).toBeUndefined();
	expect(await limit()).toBeUndefined();
	expect(asked).toBe(1);
	expect(pins.get("anthropic")).toBe(personal.id);

	// Answering again forgets the choice, and the next limit asks once more.
	declined.get("anthropic")?.delete(personal.id);
	limited.get("anthropic")?.delete(personal.id);
	await limit();
	expect(asked).toBe(2);
});

test("closing the limit dialog with esc counts as stopping there", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal] = store.accounts("anthropic");
	if (personal === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const declined = new Map<string, Set<string>>();
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: { setStatus: () => {}, notify: () => {}, select: async () => undefined },
	});

	await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429", new Map(), declined);
	expect(declined.get("anthropic")?.has(personal.id)).toBe(true);
});

test("a second account that refuses in the same session is not asked about again", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const limited = new Map<string, Set<string>>();
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	let asked = 0;
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				asked += 1;
				return options[0];
			},
		},
	});

	const moved = await afterLimit(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		personal.id,
		"limit",
		limited,
	);
	expect(moved?.id).toBe(work.id);
	expect(asked).toBe(1);

	const exhausted = await afterLimit(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		work.id,
		"limit",
		limited,
	);
	expect(exhausted).toBeUndefined();
	expect(asked).toBe(1);
});

test("a refused login signs in again without losing the account", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const pins: Pins = new Map([["anthropic", work.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onAuthFailure]);
	store.markError("anthropic", work.id, "auth", "invalid_grant");
	const fresh: Credential = { type: "oauth", access: "fresh", refresh: "r2", expires: 0 };
	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => fresh,
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => options[0],
		},
		modelRegistry: { getProvider: () => provider },
	});

	const moved = await afterAuthFailure(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		work.id,
		"invalid_grant",
	);

	expect(moved?.id).toBe(work.id);
	expect(moved?.credential).toEqual(fresh);
	const saved = new AccountStore().accounts("anthropic")[0];
	expect(saved?.label).toBe("work");
	expect(saved?.credential).toEqual(fresh);
	expect(saved?.health).toBeUndefined();
});

test("a usage limit gets the line that stops pi's retry", async () => {
	const store = new AccountStore();
	const added = store.add("anthropic", "work", OAUTH);
	store.setActive("anthropic", added.account?.id);

	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const fired = (await fake.fire(
		"message_end",
		{
			type: "message_end",
			message: {
				role: "assistant",
				provider: "anthropic",
				stopReason: "error",
				errorMessage: WINDOW,
			},
		},
		fakeContext([], true, {}),
	)) as Array<{ message?: { errorMessage?: string } } | undefined>;

	expect(fired[0]?.message?.errorMessage).toBe(
		"anthropic · work: usage limit reached (quota exceeded)",
	);
});

test("an account removed while it served can still move to a saved one", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OTHER);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onAuthFailure]);
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => options[0],
		},
	});

	const moved = await afterAuthFailure(scope, store, new Map(), ctx, "anthropic", "gone", "401");

	expect(moved?.id).toBe(work.id);
});

test("the replacement line stops pi's retry with the marker it reads", () => {
	const text = usageLimitLine(
		{ provider: "anthropic", stopReason: "error", errorMessage: WINDOW },
		"work",
		"resets in 11m",
	);
	expect(text).toBe("anthropic · work: usage limit reached, resets in 11m (quota exceeded)");
	expect(text).toContain("quota exceeded");
});

test("a finished message or another error is left alone", () => {
	expect(usageLimitLine({ provider: "anthropic", stopReason: "stop" }, "work")).toBeUndefined();
	expect(
		usageLimitLine(
			{ provider: "anthropic", stopReason: "error", errorMessage: "500 oops" },
			"work",
		),
	).toBeUndefined();
});

test("the account picker shows what each account has left", async () => {
	const store = new AccountStore();
	const work = store.add("anthropic", "work", OAUTH).account;
	store.add("anthropic", "personal", OTHER);
	if (work === undefined) throw new Error("no account");
	const scope = fakeScope({ pi: fakePi() });
	const watch: Watch = {
		limited: new Map(),
		declined: new Map(),
		usage: new Map(),
		quota: new Quota({ anthropic: anthropicQuota(() => "2.1.280") }),
	};
	const body = {
		limits: [
			{
				kind: "session",
				percent: 62,
				is_active: true,
				resets_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
			},
			{
				kind: "weekly_all",
				percent: 30,
				is_active: false,
				resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
			},
		],
	};
	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
	try {
		// The session reads the plans in the background; here it is the test that fills the cache.
		await watch.quota.ensure("anthropic", work.id, "token");
		let shown: string[] = [];
		const ctx = fakeContext([], true, {
			model: { provider: "anthropic" },
			modelRegistry: { getProviderDisplayName: () => "Anthropic" },
			ui: {
				theme: { fg: (_role: string, text: string) => text, bold: (text: string) => text },
				setStatus: () => {},
				notify: () => {},
				select: async (_title: string, options: string[]) => {
					shown = options;
					return undefined;
				},
			},
		});

		await pickAccount(bundle(scope, store, watch), ctx);

		// The api-key account has no endpoint to ask, so only the OAuth one carries numbers.
		expect(shown).toHaveLength(2);
		expect(shown[0]).toContain(
			"work (subscription) ✓  5h    62% resets in 2h    week  30% resets in 4d",
		);
		expect(shown[1]).toBe("personal (api key)");
	} finally {
		mock.mockRestore();
	}
});

test("a session reads the plans in the background", async () => {
	const valid: Credential = {
		type: "oauth",
		access: "a",
		refresh: "r",
		expires: Date.now() + 3_600_000,
	};
	new AccountStore().add("anthropic", "work", valid);
	const fake = fakePi();
	fake.pi.registerProvider = (() => {}) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const mock = spyOn(globalThis, "fetch");
	// The endpoint refuses and the one-token call answers with the window in its headers.
	mock.mockResolvedValue(
		new Response("{}", {
			status: 429,
			headers: { "anthropic-ratelimit-unified-5h-utilization": "0.5" },
		}),
	);
	try {
		const ctx = fakeContext([], true, {
			model: { provider: "anthropic" },
			modelRegistry: { getProvider: () => native() },
			sessionManager: { getBranch: () => [] },
			ui: { notify: () => {}, setStatus: () => {} },
		});
		await fake.fire("session_start", {}, ctx);

		expect(mock).toHaveBeenCalledTimes(2);
		expect(String(mock.mock.calls[0]?.[0])).toContain("/api/oauth/usage");
		expect(String(mock.mock.calls[1]?.[0])).toContain("/v1/messages");
	} finally {
		mock.mockRestore();
	}
});

test("a refused credential is remembered until a sign-in", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const pins: Pins = new Map([["anthropic", work.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onAuthFailure]);
	scope.settings.set(onAuthFailure, "stop");
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: { setStatus: () => {}, notify: () => {}, select: async () => undefined },
	});

	const moved = await afterAuthFailure(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		work.id,
		"invalid_grant",
	);

	expect(moved).toBeUndefined();
	expect(new AccountStore().accounts("anthropic")[0]?.health?.lastError).toMatchObject({
		kind: "auth",
		message: "invalid_grant",
	});
});

test("the picker says when an account needs a sign-in", async () => {
	const store = new AccountStore();
	const added = store.add("anthropic", "work", OAUTH).account;
	if (added === undefined) throw new Error("no account");
	store.markError("anthropic", added.id, "auth", "401");
	const scope = fakeScope({ pi: fakePi() });
	const watch: Watch = {
		limited: new Map(),
		declined: new Map(),
		usage: new Map(),
		// No reader here: this test reads the labels, and a background plan read from it
		// would still be in the air when the next test counts fetches.
		quota: new Quota({}),
	};
	let shown: string[] = [];
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		modelRegistry: { getProviderDisplayName: () => "Anthropic" },
		ui: {
			theme: { fg: (_role: string, text: string) => text, bold: (text: string) => text },
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				shown = options;
				return undefined;
			},
		},
	});

	await pickAccount(bundle(scope, store, watch), ctx);

	expect(shown[0]).toContain("sign in again");
});

test("the picker lists the accounts and never pi's own login", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: OTHER }));
	const scope = fakeScope({ pi: fakePi() });
	const watch: Watch = {
		limited: new Map(),
		declined: new Map(),
		usage: new Map(),
		// No reader here, for the same reason.
		quota: new Quota({}),
	};
	let shown: string[] = [];
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		modelRegistry: { getProviderDisplayName: () => "Anthropic" },
		ui: {
			theme: { fg: (_role: string, text: string) => text, bold: (text: string) => text },
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				shown = options;
				return undefined;
			},
		},
	});

	await pickAccount(bundle(scope, store, watch), ctx);

	expect(shown).toEqual(["work (subscription) ✓"]);
});

function bundle(scope: Accounts["scope"], store: AccountStore, watch: Watch): Accounts {
	return { scope, store, pins: new Map(), watch };
}

test("a model of another provider reads that provider's plans right away", async () => {
	const valid: Credential = {
		type: "oauth",
		access: "a",
		refresh: "r",
		expires: Date.now() + 3_600_000,
	};
	new AccountStore().add("anthropic", "work", valid);
	const fake = fakePi();
	fake.pi.registerProvider = (() => {}) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 40 } })));
	try {
		// A plan read an earlier test left in flight lands now, so it is not counted here.
		await settle();
		mock.mockClear();
		const ctx = fakeContext([], true, {
			model: { provider: "deepseek" },
			modelRegistry: { getProvider: () => native() },
			sessionManager: { getBranch: () => [] },
			ui: { notify: () => {}, setStatus: () => {} },
		});
		await fake.fire("session_start", {}, ctx);
		await settle();
		expect(mock).not.toHaveBeenCalled();

		await fake.fire(
			"model_select",
			{ type: "model_select", model: { provider: "anthropic" } },
			ctx,
		);
		await settle();
		expect(String(mock.mock.calls[0]?.[0])).toContain("/api/oauth/usage");
	} finally {
		mock.mockRestore();
	}
});

test("the first account brings pi's own login along, under a name of its own", async () => {
	writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: OTHER }));
	const fake = fakePi();
	fake.pi.registerProvider = (() => {}) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => OAUTH as OAuthCredential,
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const asked: string[] = [];
	const answers = ["personal", "work"];
	const ctx = fakeContext([], true, {
		ui: {
			notify: () => {},
			setStatus: () => {},
			input: async (title: string) => {
				asked.push(title);
				return answers.shift();
			},
			select: async (_title: string, options: string[]) => options.at(-1),
		},
		modelRegistry: {
			getProvider: () => provider,
			getProviderDisplayName: () => "Anthropic",
			getAll: () => [{ provider: "anthropic", id: "claude" }],
		},
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	const handler = fake.commands.get("accounts")?.handler;
	if (handler === undefined) throw new Error("no accounts command");
	await handler("anthropic", ctx as never);

	expect(asked).toEqual([
		"Name the Anthropic api key login you already have",
		"Name the new Anthropic account",
	]);
	const store = new AccountStore();
	const saved = store.accounts("anthropic");
	expect(saved.map((account) => [account.label, account.credential])).toEqual([
		["personal", OTHER],
		["work", OAUTH],
	]);
	expect(store.active("anthropic")?.label).toBe("work");
});

/** Lets the plans read in the background settle: the mocked fetch answers within microtasks. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

test("requests that hit a limit at once share one dialog and its answer", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	let dialogs = 0;
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		modelRegistry: { getProvider: () => undefined },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				dialogs++;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return options[0];
			},
		},
	});
	const watch: Watch = {
		limited: new Map(),
		declined: new Map(),
		usage: new Map(),
		quota: new Quota({}),
	};
	const session = sessionFor(scope, store, pins, watch, ctx, "anthropic");

	// The turn and the tasks' call, both on the account that just ran out.
	const [turn, goal] = await Promise.all([
		session.afterLimit(personal.id, "429"),
		session.afterLimit(personal.id, "429"),
	]);
	expect(dialogs).toBe(1);
	expect(turn?.id).toBe(work.id);
	expect(goal?.id).toBe(work.id);
});
