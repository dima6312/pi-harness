import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { fakeContext } from "@adeildo/pi-kit/testing";
import type { Credential, Provider } from "@earendil-works/pi-ai";

import { readingFor, type Watch } from "../src/accounts/attach.ts";
import { liftProvider } from "../src/accounts/lift.ts";
import { AccountStore } from "../src/accounts/store.ts";
import { anthropicQuota } from "../src/usage/anthropic.ts";
import { Quota } from "../src/usage/quota.ts";
import { agentDirFixture } from "./helpers.ts";

const EXPIRED: Credential = { type: "oauth", access: "old", refresh: "r", expires: 0 };
const FRESH: Credential = {
	type: "oauth",
	access: "fresh",
	refresh: "r2",
	expires: Date.now() + 3_600_000,
};

let restore: () => void;

beforeEach(() => {
	restore = agentDirFixture("pi-accounts-plan-").restore;
});

afterEach(() => restore());

function watch(): Watch {
	return {
		limited: new Map(),
		declined: new Map(),
		usage: new Map(),
		quota: new Quota({ anthropic: anthropicQuota(() => "2.1.280") }),
	};
}

function provider(refresh: () => Promise<Credential>): Provider {
	return {
		auth: {
			oauth: {
				name: "Claude Pro/Max",
				login: async () => FRESH,
				refresh,
				toAuth: async () => ({}),
			},
		},
	} as unknown as Provider;
}

function context(refresher: Provider) {
	return fakeContext([], true, { modelRegistry: { getProvider: () => refresher } });
}

function usageBody(percent: number): string {
	return JSON.stringify({
		five_hour: { utilization: percent, resets_at: new Date(Date.now() + 7_200_000).toISOString() },
	});
}

test("an expired account token is refreshed before the plan is read", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", EXPIRED);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");

	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(usageBody(50), { status: 200 }));
	try {
		const reading = await readingFor(
			watch(),
			store,
			context(provider(async () => FRESH)),
			"anthropic",
			work.id,
		);

		expect(reading?.session?.used).toBe(50);
		expect(new AccountStore().accounts("anthropic")[0]?.credential).toEqual(FRESH);
		const headers = mock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer fresh");
	} finally {
		mock.mockRestore();
	}
});

test("a refresh that fails marks the account and reads nothing", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", EXPIRED);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");

	const reading = await readingFor(
		watch(),
		store,
		context(
			provider(async () => {
				throw new Error("invalid_grant");
			}),
		),
		"anthropic",
		work.id,
	);

	expect(reading).toBeUndefined();
	expect(new AccountStore().accounts("anthropic")[0]?.health?.lastError).toMatchObject({
		kind: "auth",
		message: "invalid_grant",
	});
});

test("a plan is renewed through the provider underneath, not the account in use", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", FRESH);
	store.add("anthropic", "home", EXPIRED);
	const [work, home] = store.accounts("anthropic");
	if (work === undefined || home === undefined) throw new Error("no accounts");
	const renewed: Credential[] = [];
	const underneath = provider(async () => FRESH);
	const oauth = underneath.auth.oauth;
	if (oauth === undefined) throw new Error("no oauth");
	oauth.refresh = async (credential) => {
		renewed.push(credential);
		return { ...FRESH, access: "home-fresh" };
	};
	// The lifted provider would renew the account in use; the plan belongs to the one asked about.
	const lifted = liftProvider(underneath, {
		resolve: () => ({ id: work.id, credential: work.credential }),
		save: () => {},
		afterLimit: async () => undefined,
	});

	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(usageBody(20), { status: 200 }));
	try {
		await readingFor(watch(), store, context(lifted), "anthropic", home.id);

		expect(renewed).toEqual([EXPIRED]);
		const headers = mock.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer home-fresh");
	} finally {
		mock.mockRestore();
	}
});
