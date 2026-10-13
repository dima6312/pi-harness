import { hostname } from "node:os";

import type { AccountState, PeerMark, SessionTasks } from "@adeildo/pi-kit";
import { VERSION, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { GitState } from "./git.ts";
import type { RequestView, RunView } from "./telemetry.ts";
import {
	type Averages,
	averagesOf,
	cacheHitPercent,
	cacheWarming,
	emptyTotals,
	type Totals,
	totalsOf,
} from "./totals.ts";

export interface ModelInfo {
	name: string;
	provider: string;
	reasoning: boolean;
}

export interface ContextInfo {
	percent: number;
	tokens: number;
	window: number;
}

export interface Snapshot {
	now: number;
	cwd: string;
	home: string | undefined;
	branch: string | null;
	git: GitState | undefined;
	host: string | undefined;
	sessionName: string | undefined;
	version: string;
	model: ModelInfo | undefined;
	account: AccountState | undefined;
	thinking: string | undefined;
	context: ContextInfo | undefined;
	totals: Totals;
	cacheHit: number | undefined;
	cacheWarming: boolean;
	subscription: boolean;
	request: RequestView | undefined;
	last: RequestView | undefined;
	run: RunView | undefined;
	averages: Averages;
	statuses: ReadonlyMap<string, string>;
	/** What the session is doing, when a tasks feature keeps it. */
	tasks: SessionTasks | undefined;
	/** The other sessions in this folder, when a peers feature keeps them. */
	peers: PeerMark[];
	/** Messages a peer sent this session that its agent has not read yet. */
	peersUnread: number;
}

export function emptySnapshot(): Snapshot {
	return {
		now: 0,
		cwd: "",
		home: undefined,
		branch: null,
		git: undefined,
		host: undefined,
		sessionName: undefined,
		version: VERSION,
		model: undefined,
		account: undefined,
		thinking: undefined,
		context: undefined,
		totals: emptyTotals(),
		cacheHit: undefined,
		cacheWarming: false,
		subscription: false,
		request: undefined,
		last: undefined,
		run: undefined,
		averages: { decode: undefined, prefill: undefined },
		statuses: new Map(),
		tasks: undefined,
		peers: [],
		peersUnread: 0,
	};
}

export interface LiveInputs {
	branch: string | null;
	git: GitState | undefined;
	account?: AccountState | undefined;
	request: RequestView | undefined;
	last: RequestView | undefined;
	run: RunView | undefined;
	statuses: ReadonlyMap<string, string>;
	tasks?: SessionTasks | undefined;
	peers?: PeerMark[] | undefined;
	peersUnread?: number | undefined;
}

interface Derived {
	totals: Totals;
	cacheHit: number | undefined;
	cacheWarming: boolean;
	averages: Averages;
}

export class SnapshotReader {
	#key: string | undefined;
	#derived: Derived | undefined;
	readonly #host = hostname().split(".")[0];

	read(ctx: ExtensionContext, live: LiveInputs): Snapshot {
		const model = ctx.model;
		const derived = this.#derive(ctx);

		return {
			now: Date.now(),
			cwd: ctx.cwd,
			home: process.env.HOME ?? process.env.USERPROFILE,
			branch: live.branch,
			git: live.git,
			host: this.#host,
			sessionName: ctx.sessionManager.getSessionName(),
			version: VERSION,
			model:
				model === undefined
					? undefined
					: {
							name: model.name ?? model.id,
							provider: ctx.modelRegistry.getProviderDisplayName(model.provider),
							reasoning: model.reasoning,
						},
			thinking: ctx.thinkingLevel,
			account: live.account,
			context: contextOf(ctx),
			...derived,
			subscription: model === undefined ? false : ctx.modelRegistry.isUsingOAuth(model),
			request: live.request,
			last: live.last,
			run: live.run,
			statuses: new Map(
				[...live.statuses.entries()]
					.toSorted(([a], [b]) => a.localeCompare(b))
					.map(([key, text]): [string, string] => [key, sanitize(text)])
					.filter(([, text]) => text !== ""),
			),
			tasks: live.tasks,
			peers: live.peers ?? [],
			peersUnread: live.peersUnread ?? 0,
		};
	}

	#derive(ctx: ExtensionContext): Derived {
		// Every entry is appended at the leaf, so the leaf moving is the only way the sums change.
		const key = ctx.sessionManager.getLeafId() ?? "";
		if (this.#derived !== undefined && key === this.#key) return this.#derived;

		const entries: readonly SessionEntry[] = ctx.sessionManager.getBranch();
		this.#key = key;
		this.#derived = {
			totals: totalsOf(entries),
			cacheHit: cacheHitPercent(entries),
			cacheWarming: cacheWarming(entries),
			averages: averagesOf(entries),
		};
		return this.#derived;
	}
}

function contextOf(ctx: ExtensionContext): ContextInfo | undefined {
	const usage = ctx.getContextUsage();
	if (usage === undefined || usage.percent === null || usage.tokens === null) return undefined;
	return { percent: usage.percent, tokens: usage.tokens, window: usage.contextWindow };
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]+/g, " ").trim();
}
