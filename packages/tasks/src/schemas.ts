import { type TSchema, Type } from "@earendil-works/pi-ai";

import type { Moment } from "./prompts.ts";

function text(description: string): TSchema {
	return Type.String({ description });
}

function literals(...values: string[]): TSchema {
	return Type.Union(values.map((value) => Type.Literal(value)));
}

const ID = text("A task's id from the list, like t3.");
const TASK = text("Imperative, under 60 characters, in the operator's language.");
const PROOF = text("The operator's words that say it, copied exactly from the message.");
const WHY = text("Why, in a few words.");
const TITLE = text("What the session is about, in English, 2 to 5 words, at most 40 characters.");
const CHOICE = text("What was chosen, in a short sentence.");
const INSTEAD_OF = text(
	'The alternative that was not chosen, like "two separate keys", or "" when there was none.',
);

function shape(
	name: string,
	fields: Record<string, TSchema>,
	optional: Record<string, TSchema> = {},
): TSchema {
	const extra = Object.fromEntries(
		Object.entries(optional).map(([key, schema]) => [key, Type.Optional(schema)]),
	);
	return Type.Object({ op: Type.Literal(name), ...fields, ...extra });
}

const MESSAGE_SCHEMA = Type.Object({
	language: text("The English name of the message's language, like 'Portuguese'."),
	ops: Type.Array(
		Type.Union([
			shape(
				"continue_task",
				{ id: ID },
				{ text: text("The task's new words, only when the ask changed.") },
			),
			shape("new_task", {
				proof: text("The operator's words that ask for this work."),
				text: TASK,
			}),
			shape("defer_task", { id: ID, why: WHY, proof: PROOF }),
			shape("drop_task", { id: ID, why: WHY, proof: PROOF }),
			shape("you_did", { id: ID, proof: PROOF }),
			shape("decide", {
				instead_of: INSTEAD_OF,
				text: CHOICE,
				proof: PROOF,
			}),
			shape("title", { text: TITLE }),
		]),
	),
});

/** Evidence first, so the model reads before it decides. */
const VERDICT = Type.Object({
	id: ID,
	evidence: text(
		'The ref of the said: or report: line that reports it done, or where the agent asks or says what it waits on, like "L12", or "". Never a call: line.',
	),
	outcome: literals("untouched", "done", "progress", "waiting"),
	result: text('Done: what came out of it, or "".'),
	left: text('What it did not do, or "".'),
	waiting_on: literals("you", "outside"),
	why: text('Waiting: why, or "".'),
});

const RUN_SCHEMA = Type.Object({
	tasks: Type.Array(VERDICT),
	decisions: Type.Array(
		Type.Object({
			evidence: text('The ref of the line that reports the choice, like "L7".'),
			instead_of: INSTEAD_OF,
			text: CHOICE,
		}),
	),
});

const TIDY_SCHEMA = Type.Object({
	ops: Type.Array(
		Type.Union([
			shape("merge", { id: text("The task that goes."), into: text("The task that stays.") }),
			shape("rename", { id: ID, text: TASK }),
			shape("title", { text: TITLE }),
		]),
	),
});

export const SCHEMAS: Record<Moment, TSchema> = {
	message: MESSAGE_SCHEMA,
	run: RUN_SCHEMA,
	tidy: TIDY_SCHEMA,
};
