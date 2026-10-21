// What one feature knows and the others read, over pi.events, which every extension in a process
// shares. A contract is declared once in `contracts/`, never in the package that owns the state, so
// the reader does not depend on the owner.
//
// The bus is synchronous, so a reader asks while drawing and the owner answers on the spot: the
// value is never a frame old. A change is also announced with the whole new value, so a bridge can
// follow every contract without polling and without knowing what any of them hold. Values are plain
// JSON, and they are decoded on arrival, because the other side may be another version.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Decoder, formatProblems, isObject } from "./decode.ts";

/** What a contract needs to travel. A feature scope is one. */
export interface EventScope {
	readonly events: ExtensionAPI["events"];
	warn(message: string): void;
}

/** A contract with a key takes it as one more argument; one without takes nothing. */
type KeyArgs<K> = [K] extends [void] ? [] : [key: K];

export interface Contract<T, K extends string | void = void> {
	/** The pi.events channel readers ask on. Changes go on the same channel plus `:changed`. */
	readonly channel: string;
	/** Undefined when nobody provides it, or the answer does not decode, which warns. */
	current(scope: EventScope, ...key: KeyArgs<K>): T | undefined;
	/**
	 * Answers the readers. An undefined answer leaves the question to another provider. Returns what
	 * stops answering.
	 */
	provide(scope: EventScope, answer: (key: K) => T | undefined): () => void;
	/** Tells every listener the new value. Undefined says there is none any more. */
	changed(scope: EventScope, value: T | undefined, ...key: KeyArgs<K>): void;
	/** A change that does not decode is dropped with a warning. */
	onChanged(scope: EventScope, listener: (value: T | undefined, key: K) => void): () => void;
}

interface Question {
	key?: unknown;
	answered?: boolean;
	value?: unknown;
}

/** Name it `<area>` or `<area>:<what>`, like `tasks` or `calls:ruling`. */
export function defineContract<T, K extends string | void = void>(
	name: string,
	decoder: Decoder<T>,
): Contract<T, K> {
	const channel = `harness:${name}`;
	const changes = `${channel}:changed`;

	function decoded(scope: EventScope, value: unknown, what: string): T | undefined {
		const result = decoder.decode(value, name);
		if (result.ok) return result.value;
		scope.warn(`ignored ${what} ${name}: ${formatProblems(result.problems).join("; ")}`);
		return undefined;
	}

	return {
		channel,
		current(scope, ...key) {
			const question: Question = { key: key[0] };
			scope.events.emit(channel, question);
			if (question.answered !== true) return undefined;
			return decoded(scope, question.value, "an answer to");
		},
		provide(scope, answer) {
			return scope.events.on(channel, (data) => {
				if (!isObject(data) || data.answered === true) return;
				const value = answer(data.key as K);
				if (value === undefined) return;
				data.value = value;
				data.answered = true;
			});
		},
		changed(scope, value, ...key) {
			scope.events.emit(changes, { key: key[0], value });
		},
		onChanged(scope, listener) {
			return scope.events.on(changes, (data) => {
				if (!isObject(data)) return;
				if (data.value === undefined) {
					listener(undefined, data.key as K);
					return;
				}
				const value = decoded(scope, data.value, "a change of");
				if (value !== undefined) listener(value, data.key as K);
			});
		},
	};
}
