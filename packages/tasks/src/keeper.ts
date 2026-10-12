import {
	applyTaskOps,
	emptyTasks,
	type SessionTasks,
	TASKS_ENTRY,
	TASKS_USAGE_ENTRY,
	TASKS_VERSION,
	type TaskOp,
	type TasksCall,
	type TasksTrigger,
	type TasksUpdate,
	tasksFromEntries,
} from "@adeildo/pi-kit";

import type { Proposal } from "./ask.ts";

export interface ChangeContext {
	entry?: string;
	covers?: TasksUpdate["covers"];
	busy?: boolean;
	proposal?: Proposal;
}

type Append = (customType: string, data: unknown) => void;

export class Keeper {
	#state: SessionTasks = emptyTasks();
	readonly #append: Append;
	readonly #changed: (trigger: TasksTrigger) => void;

	constructor(append: Append, changed: (trigger: TasksTrigger) => void) {
		this.#append = append;
		this.#changed = changed;
	}

	state(): SessionTasks {
		return this.#state;
	}

	restore(branch: readonly unknown[]): void {
		this.#state = tasksFromEntries(branch);
	}

	apply(ops: readonly TaskOp[], trigger: TasksTrigger, context: ChangeContext = {}): boolean {
		const origin = trigger === "message" || trigger === "you" ? "you" : "agent";
		const next = applyTaskOps(this.#state, ops, {
			at: Date.now(),
			origin,
			...(context.entry === undefined ? {} : { entry: context.entry }),
			...(context.busy ? { busy: true } : {}),
		});
		if (same(next, this.#state)) return false;
		this.#state = next;
		const { proposal, covers } = context;
		const update: TasksUpdate = {
			version: TASKS_VERSION,
			trigger,
			ops: [...ops],
			...(covers === undefined ? {} : { covers }),
			...(proposal === undefined ? {} : { model: proposal.model, usage: proposal.usage }),
			...(proposal?.rejected.length ? { rejected: proposal.rejected } : {}),
			state: next,
		};
		this.#append(TASKS_ENTRY, update);
		this.#changed(trigger);
		return true;
	}

	settle(
		proposal: Proposal,
		trigger: TasksTrigger,
		context: Omit<ChangeContext, "proposal"> = {},
	): void {
		if (this.apply(proposal.ops, trigger, { ...context, proposal })) return;
		const call: TasksCall = { trigger, model: proposal.model, usage: proposal.usage };
		if (proposal.rejected.length > 0) call.rejected = proposal.rejected;
		this.#append(TASKS_USAGE_ENTRY, call);
	}
}

/** Leaves `updatedAt` out, since every apply moves it. */
function same(left: SessionTasks, right: SessionTasks): boolean {
	return JSON.stringify({ ...left, updatedAt: 0 }) === JSON.stringify({ ...right, updatedAt: 0 });
}
