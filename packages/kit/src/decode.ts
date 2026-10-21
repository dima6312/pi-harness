// Decoders for everything that comes from outside: settings files and event payloads from other
// packages. The only module that inspects `typeof`, and no decoder throws. `control` is how the
// settings screen edits the value.
import type { Control } from "./control.ts";

export interface Problem {
	path: string;
	message: string;
}

export type Decoded<T> =
	| { ok: true; value: T; problems: Problem[] }
	| { ok: false; problems: Problem[] };

export interface Decoder<T> {
	decode(input: unknown, path: string): Decoded<T>;
	control?: Control;
}

export function pass<T>(value: T, problems: Problem[] = []): Decoded<T> {
	return { ok: true, value, problems };
}

export function fail<T>(entry: Problem): Decoded<T> {
	return { ok: false, problems: [entry] };
}

export function problem(path: string, message: string): Problem {
	return { path, message };
}

export function fieldPath(path: string, key: string): string {
	return path === "" ? key : `${path}.${key}`;
}

export function formatProblems(problems: Problem[]): string[] {
	return problems.map((entry) => `${entry.path}: ${entry.message}`);
}

export function isObject(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

export const string: Decoder<string> = {
	control: { type: "text" },
	decode(input, path) {
		return typeof input === "string" ? pass(input) : fail(problem(path, "expected a string"));
	},
};

export const trimmedString: Decoder<string> = {
	control: { type: "text" },
	decode(input, path) {
		if (typeof input !== "string" || input.trim() === "")
			return fail(problem(path, "expected a non-empty string"));
		return pass(input.trim());
	},
};

export const boolean: Decoder<boolean> = {
	control: { type: "toggle" },
	decode(input, path) {
		return typeof input === "boolean" ? pass(input) : fail(problem(path, "expected a boolean"));
	},
};

export const unit: Decoder<number> = {
	control: { type: "number", min: 0, max: 1, step: 0.05 },
	decode(input, path) {
		if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1)
			return fail(problem(path, "expected a number from 0 to 1"));
		return pass(input);
	},
};

export const duration: Decoder<number> = {
	control: { type: "number", min: 0, step: 500, unit: "ms" },
	decode(input, path) {
		if (typeof input !== "number" || !Number.isFinite(input) || input < 0)
			return fail(problem(path, "expected a non-negative number of milliseconds"));
		return pass(input);
	},
};

/** A whole number from `min` to `max`, inclusive. */
export function integer(min: number, max: number): Decoder<number> {
	return {
		control: { type: "number", min, max, step: 1 },
		decode(input, path) {
			if (typeof input !== "number" || !Number.isInteger(input) || input < min || input > max) {
				return fail(problem(path, `expected a whole number from ${min} to ${max}`));
			}
			return pass(input);
		},
	};
}

/** A string that matches `pattern`, described to the user as `expected`. */
export function matching(pattern: RegExp, expected: string): Decoder<string> {
	return {
		control: { type: "text" },
		decode(input, path) {
			if (typeof input === "string" && pattern.test(input)) return pass(input);
			return fail(problem(path, `expected ${expected}`));
		},
	};
}

export function literal<const T extends readonly string[]>(...values: T): Decoder<T[number]> {
	const expected = values.map((value) => `"${value}"`).join(" or ");
	return {
		control: { type: "choice", options: values.map((value) => ({ value })) },
		decode(input, path) {
			if (typeof input === "string" && (values as readonly string[]).includes(input))
				return pass(input as T[number]);
			return fail(problem(path, `expected ${expected}`));
		},
	};
}

export function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
	const control: Control | undefined =
		inner.control?.type === "number" ? { ...inner.control, nullable: true } : inner.control;
	return {
		control,
		decode(input, path) {
			return input === null ? pass(null) : inner.decode(input, path);
		},
	};
}

export function withDefaultOf<T>(inner: Decoder<T>, fallback: () => T): Decoder<T> {
	return {
		control: inner.control,
		decode(input, path) {
			if (input === undefined) return pass(fallback());
			const result = inner.decode(input, path);
			return result.ok ? result : pass(fallback(), result.problems);
		},
	};
}

export function withDefault<T>(inner: Decoder<T>, fallback: T): Decoder<T> {
	return withDefaultOf(inner, () => fallback);
}

export function stringList(expected: string): Decoder<string[]> {
	const notAList = `expected an array of ${expected}`;
	const dropped = "ignored entries that are not non-empty strings";

	return {
		control: { type: "list" },
		decode(input, path) {
			if (!Array.isArray(input)) return fail(problem(path, notAList));

			const value: string[] = [];
			let missing = 0;
			for (const entry of input) {
				if (typeof entry === "string" && entry !== "") value.push(entry);
				else missing++;
			}

			const problems = missing > 0 ? [problem(path, dropped)] : [];
			return pass(value, problems);
		},
	};
}

export function stringListOrEmpty(
	fallback: readonly string[],
	expected: string,
): Decoder<string[]> {
	const parse = stringList(expected);
	return {
		control: parse.control,
		decode(input, path) {
			if (input === undefined) return pass([...fallback]);
			const result = parse.decode(input, path);
			return result.ok ? result : pass([], result.problems);
		},
	};
}

/** A value checked by a type guard, for shapes that already have one. */
export function guarded<T>(test: (input: unknown) => input is T, expected: string): Decoder<T> {
	return {
		decode(input, path) {
			return test(input) ? pass(input) : fail(problem(path, `expected ${expected}`));
		},
	};
}

export function object<T extends Record<string, unknown>>(shape: {
	[K in keyof T]: Decoder<T[K]>;
}): Decoder<T> {
	return {
		decode(input, path) {
			if (!isObject(input)) return fail(problem(path, "expected an object"));

			const problems: Problem[] = [];
			const value = {} as T;
			let complete = true;

			for (const key of Object.keys(shape) as (keyof T & string)[]) {
				const result = shape[key].decode(input[key], fieldPath(path, key));
				problems.push(...result.problems);
				if (result.ok) value[key] = result.value;
				else complete = false;
			}

			return complete ? pass(value, problems) : { ok: false, problems };
		},
	};
}
