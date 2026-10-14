import {
	emptyTotals,
	perSecond,
	promptOf,
	type RequestRecord,
	type Totals,
	usageTotals,
} from "./totals.ts";

const MIN_SAMPLE_MS = 250;
/** Measured over 16,889 assistant messages of one machine: 2.88 characters per output token. */
const DEFAULT_CHARS_PER_TOKEN = 2.9;

/** What a delta carried, so the wait for the first thought can be told from the first word. */
export type DeltaKind = "thinking" | "writing";

export interface RequestView {
	streaming: boolean;
	waiting: boolean;
	elapsedMs: number;
	/** From the request leaving to the first token of any kind: what you waited for the model. */
	waitMs: number | undefined;
	/** The same wait while it is still running, so the number counts from the moment it left. */
	waitingMs: number;
	/** From the request leaving to the response headers: the provider's own latency. */
	serverMs: number | undefined;
	/** From the headers to the first token: the model reading the prompt. */
	prefillMs: number | undefined;
	/** From the first thought to the first word written. Unset when it wrote without thinking. */
	thoughtMs: number | undefined;
	decode: number | undefined;
	prefill: number | undefined;
	usage: Totals;
	estimated: boolean;
}

export interface RunView {
	running: boolean;
	elapsedMs: number;
	requests: number;
	/** What the run's answers cost so far, at the provider's prices. */
	cost: number;
}

interface Request {
	startedAt: number;
	/** When the request left, from pi's own `before_provider_request`. */
	sentAt: number | undefined;
	headersAt: number | undefined;
	firstTokenAt: number | undefined;
	firstWritingAt: number | undefined;
	endedAt: number | undefined;
	usage: Totals;
	characters: number;
}

interface Run {
	startedAt: number;
	endedAt: number | undefined;
	requests: number;
	cost: number;
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

function span(from: number | undefined, to: number | undefined): number | undefined {
	return from === undefined || to === undefined ? undefined : to - from;
}

export class Telemetry {
	readonly #now: () => number;
	#run: Run | undefined;
	#request: Request | undefined;
	#last: RequestView | undefined;
	/** The marks of the request in flight, which arrive before the pi message it belongs to. */
	#sentAt: number | undefined;
	#headersAt: number | undefined;
	/** Characters and tokens of the answers that finished, for the live estimate to use a real ratio. */
	#sampled = { characters: 0, output: 0 };

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	runStarted(): void {
		this.#run = { startedAt: this.#now(), endedAt: undefined, requests: 0, cost: 0 };
	}

	runEnded(): void {
		if (this.#run !== undefined && this.#run.endedAt === undefined) this.#run.endedAt = this.#now();
	}

	/** Fires before every call to the model, so it is the start of the wait. */
	providerRequestSent(): void {
		this.#sentAt = this.#now();
		this.#headersAt = undefined;
		this.#attach();
	}

	/** Fires when the response arrives, before its stream is read. */
	providerResponseArrived(): void {
		this.#headersAt = this.#now();
		this.#attach();
	}

	requestStarted(): void {
		// A turn begins, and nothing has left for it yet.
		this.#sentAt = undefined;
		this.#headersAt = undefined;
		this.#begin();
		if (this.#run === undefined || this.#run.endedAt !== undefined) this.runStarted();
		if (this.#run !== undefined) this.#run.requests++;
	}

	// Later requests of a turn: the model answered, a tool ran, and the next call is already on its way.
	answerStarted(): void {
		if (this.#request === undefined || this.#request.endedAt !== undefined) this.#begin();
	}

	answerGrew(delta: string, usage: UsageLike, kind: DeltaKind): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.usage = usageTotals(usage);
		if (delta.length === 0) return;
		request.characters += delta.length;
		request.firstTokenAt ??= this.#now();
		if (kind === "writing") request.firstWritingAt ??= this.#now();
	}

	answerEnded(usage: UsageLike): RequestRecord | undefined {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return undefined;

		const now = this.#now();
		request.endedAt = now;
		request.usage = usageTotals(usage);
		if (this.#run !== undefined) this.#run.cost += usage.cost.total;
		if (request.usage.output === 0 && request.firstTokenAt === undefined) return undefined;

		if (request.characters > 0 && request.usage.output > 0) {
			this.#sampled.characters += request.characters;
			this.#sampled.output += request.usage.output;
		}

		const firstTokenAt = request.firstTokenAt ?? now;
		const from = request.sentAt ?? request.startedAt;
		this.#last = this.#view(request);
		return {
			output: request.usage.output,
			prompt: promptOf(request.usage),
			firstTokenMs: firstTokenAt - from,
			generationMs: now - firstTokenAt,
		};
	}

	request(): RequestView | undefined {
		const request = this.#request;
		return request === undefined ? undefined : this.#view(request);
	}

	last(): RequestView | undefined {
		return this.#last;
	}

	run(): RunView | undefined {
		const run = this.#run;
		if (run === undefined) return undefined;
		const running = run.endedAt === undefined;
		return {
			running,
			elapsedMs: (run.endedAt ?? this.#now()) - run.startedAt,
			requests: run.requests,
			cost: run.cost,
		};
	}

	reset(): void {
		this.#run = undefined;
		this.#request = undefined;
		this.#last = undefined;
		this.#sentAt = undefined;
		this.#headersAt = undefined;
	}

	#begin(): void {
		this.#request = {
			startedAt: this.#now(),
			sentAt: this.#sentAt,
			headersAt: this.#headersAt,
			firstTokenAt: undefined,
			firstWritingAt: undefined,
			endedAt: undefined,
			usage: emptyTotals(),
			characters: 0,
		};
	}

	/** The marks belong to a request that may not exist yet: pi sends before it opens the message. */
	#attach(): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.sentAt = this.#sentAt;
		request.headersAt = this.#headersAt;
	}

	#view(request: Request): RequestView {
		const now = this.#now();
		const streaming = request.endedAt === undefined;
		const from = request.sentAt ?? request.startedAt;
		const waitMs = span(from, request.firstTokenAt);
		const estimated = streaming && request.usage.output === 0;
		const output = estimated
			? Math.round(request.characters / this.#charsPerToken())
			: request.usage.output;
		const writingMs =
			request.firstTokenAt === undefined ? 0 : (request.endedAt ?? now) - request.firstTokenAt;
		const thoughtMs = span(request.firstTokenAt, request.firstWritingAt);

		return {
			streaming,
			waiting: streaming && request.firstTokenAt === undefined,
			elapsedMs: (request.endedAt ?? now) - request.startedAt,
			waitMs,
			waitingMs: (request.endedAt ?? now) - from,
			serverMs: span(request.sentAt, request.headersAt),
			prefillMs: span(request.headersAt ?? request.sentAt, request.firstTokenAt),
			thoughtMs: thoughtMs !== undefined && thoughtMs > 0 ? thoughtMs : undefined,
			decode: writingMs < MIN_SAMPLE_MS && streaming ? undefined : perSecond(output, writingMs),
			prefill: waitMs === undefined ? undefined : perSecond(promptOf(request.usage), waitMs),
			usage: { ...request.usage, output },
			estimated,
		};
	}

	/** The measured mix of this session, or the one measured over a machine's worth of answers. */
	#charsPerToken(): number {
		const { characters, output } = this.#sampled;
		return output > 0 ? characters / output : DEFAULT_CHARS_PER_TOKEN;
	}
}
