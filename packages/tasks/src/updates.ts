import { oneAtATime } from "@adeildo/pi-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Asker, onMessage, onRun, onTidy } from "./ask.ts";
import type { Keeper } from "./keeper.ts";
import { clipMessage, heard, runSince } from "./transcript.ts";

/** A call stuck past this, like on a dialog nobody sees, gives its turn up. */
const CALL_LIMIT_MS = 90_000;

export interface UpdateOptions {
	models(ctx: ExtensionContext): Model<Api>[];
	settled(): void;
	explain(text: string): string;
	limitMs?: number;
}

export class Updates {
	readonly #keeper: Keeper;
	readonly #options: UpdateOptions;
	readonly #turns = oneAtATime();
	#stop = new AbortController();
	#working = false;
	/** The first message of a run is what it is for; the ones after arrive while it works. */
	#heardInRun = false;
	/** The last entry before the run, so its end reads all of it, whatever you sent in between. */
	#runFrom: string | undefined;
	#untidy = false;
	#messages = 0;

	constructor(keeper: Keeper, options: UpdateOptions) {
		this.#keeper = keeper;
		this.#options = options;
	}

	get working(): boolean {
		return this.#working;
	}

	get pending(): boolean {
		return this.#messages > 0;
	}

	start(): void {
		this.#stop = new AbortController();
	}

	stop(): void {
		this.#stop.abort();
		this.#working = false;
	}

	reset(): void {
		this.#untidy = this.#keeper.state().tasks.length > 0;
	}

	changed(): void {
		this.#untidy = true;
	}

	runStarted(ctx: ExtensionContext): void {
		this.#working = true;
		this.#heardInRun = false;
		this.#runFrom = ctx.sessionManager.getBranch().at(-1)?.id;
	}

	message(ctx: ExtensionContext, text: string): void {
		const busy = this.#working && this.#heardInRun;
		if (this.#working) this.#heardInRun = true;
		this.#messages++;
		void this.#queued(ctx, async (asker) => {
			// At message_end the message is not in the session yet; by now it is.
			const { entry, reply } = heard(ctx.sessionManager.getBranch(), text);
			const request = {
				state: this.#keeper.state(),
				message: clipMessage(this.#options.explain(text)),
				...(reply === undefined ? {} : { reply }),
				busy,
			};
			const proposal = await onMessage(asker, request);
			if (proposal !== undefined)
				this.#keeper.settle(proposal, "message", {
					entry,
					busy,
					covers: { from: entry, to: entry },
				});
		}).finally(() => {
			this.#messages--;
			if (this.#messages === 0) this.#options.settled();
		});
	}

	runEnded(ctx: ExtensionContext): void {
		this.#working = false;
		const from = this.#runFrom;
		void this.#queued(ctx, async (asker) => {
			const run = runSince(ctx.sessionManager.getBranch(), from);
			if (run.lines.length === 0) return;
			const state = this.#keeper.state();
			const proposal = await onRun(asker, { state, run: run.text, lines: run.lines });
			if (proposal !== undefined)
				this.#keeper.settle(proposal, "run", {
					entry: run.to,
					covers: { from: run.from, to: run.to },
				});
		}).then(() => this.#tidy(ctx));
	}

	#tidy(ctx: ExtensionContext): Promise<void> {
		return this.#queued(ctx, async (asker) => {
			if (!this.#untidy || this.#keeper.state().tasks.length < 2) return;
			this.#untidy = false;
			const proposal = await onTidy(asker, this.#keeper.state());
			if (proposal !== undefined) this.#keeper.settle(proposal, "tidy");
		});
	}

	/** One call at a time; the race drops one that ignores its signal. */
	#queued(ctx: ExtensionContext, task: (asker: Asker) => Promise<void>): Promise<void> {
		const stop = this.#stop.signal;
		const limit = this.#options.limitMs ?? CALL_LIMIT_MS;
		return this.#turns(() => {
			const signal = AbortSignal.any([stop, AbortSignal.timeout(limit)]);
			const asker = { registry: ctx.modelRegistry, models: this.#options.models(ctx), signal };
			const given = new Promise<never>((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
			return Promise.race([task(asker), given]);
		}, stop).catch(() => undefined);
	}
}
