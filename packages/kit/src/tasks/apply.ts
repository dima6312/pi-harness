import {
	isOpen,
	type Mark,
	type Origin,
	type SessionTasks,
	type Task,
	type TaskOp,
	type TaskStatus,
} from "./state.ts";

export interface ApplyOptions {
	at: number;
	origin: Origin;
	/** The entry the operations came from: your message, or the last entry of the run. */
	entry?: string;
	/** The agent is already on something you asked in this run, so a new ask waits its turn. */
	busy?: boolean;
}

/** Operations that do not fit, like closing a task that is already closed, are skipped. */
export function applyTaskOps(
	state: SessionTasks,
	ops: readonly TaskOp[],
	options: ApplyOptions,
): SessionTasks {
	const draft = new Draft(state, options);
	for (const op of ops) draft.apply(op);
	return draft.done();
}

class Draft {
	readonly #next: SessionTasks;
	readonly #options: ApplyOptions;
	readonly #mark: Mark;
	#busy: boolean;

	constructor(state: SessionTasks, options: ApplyOptions) {
		this.#next = {
			...state,
			tasks: state.tasks.map((task) => ({ ...task, asks: [...task.asks] })),
			decisions: state.decisions.map((decision) => ({ ...decision })),
		};
		this.#options = options;
		this.#busy = options.busy === true;
		this.#mark =
			options.entry === undefined ? { at: options.at } : { at: options.at, entry: options.entry };
	}

	apply(op: TaskOp): void {
		switch (op.op) {
			case "title":
				return this.#title(op.text.trim());
			case "language":
				if (this.#options.origin === "you" && op.text.trim() !== "")
					this.#next.language = op.text.trim();
				return;
			case "ask":
				return this.#ask(op.text.trim(), op.beside === true);
			case "continue": {
				const task = this.#find(op.id);
				if (task === undefined) return;
				if (op.text?.trim()) task.text = op.text.trim();
				// Asking for a task the agent wrote makes it yours.
				task.origin = "you";
				this.#heard(task);
				this.#move(task, "doing");
				this.#focus(task);
				return;
			}
			case "defer":
				return this.#close(op.id, "deferred", { why: op.why });
			case "done":
				return this.#close(op.id, "done", { result: op.result, left: op.left });
			case "progress": {
				const task = this.#find(op.id);
				if (task === undefined || !isOpen(task)) return;
				this.#move(task, "doing");
				if (op.left) task.left = op.left;
				return;
			}
			case "wait": {
				const task = this.#find(op.id);
				if (task === undefined || !isOpen(task)) return;
				this.#move(task, "waiting");
				task.waitingOn = op.on;
				task.why = op.why;
				return;
			}
			case "drop": {
				const task = this.#find(op.id);
				if (task === undefined || task.status === "dropped") return;
				// Done work is history, unless you say it was only an idea.
				if (task.status === "done" && this.#options.origin !== "you") return;
				this.#move(task, "dropped");
				if (op.why) task.why = op.why;
				return;
			}
			case "decide":
				return this.#decide(op.text.trim(), op.tasks);
			case "rename": {
				const task = this.#find(op.id);
				if (task === undefined || op.text.trim() === "") return;
				task.text = op.text.trim();
				// Words the agent rewrote are not yours anymore, so they stop reaching the judge.
				if (this.#options.origin === "agent") task.origin = "agent";
				task.updatedAt = this.#options.at;
				return;
			}
			case "merge":
				return this.#merge(op.id, op.into);
			case "idle": {
				const task = this.#find(op.id);
				if (task?.status === "queued") task.idleRuns = (task.idleRuns ?? 0) + 1;
				return;
			}
		}
	}

	done(): SessionTasks {
		this.#next.updatedAt = this.#options.at;
		return this.#next;
	}

	#title(text: string): void {
		if (text === "") return;
		this.#next.title = text;
		this.#next.titleOrigin = this.#options.origin;
	}

	#ask(text: string, beside: boolean): void {
		if (text === "") return;
		const listed = this.#listed(text);
		if (listed !== undefined) return this.apply({ op: "continue", id: listed.id });
		const task = this.#add(text, this.#busy && !beside ? "queued" : "doing", "you");
		this.#heard(task);
		this.#focus(task);
	}

	/** What you turn to between runs is what the agent does now, and the rest waits its turn. */
	#focus(task: Task): void {
		if (!this.#busy && task.status === "doing")
			for (const other of this.#next.tasks)
				if (other !== task && other.status === "doing") this.#move(other, "queued");
		this.#busy = true;
	}

	#heard(task: Task): void {
		const entry = this.#options.entry;
		if (entry !== undefined && !task.asks.includes(entry)) task.asks.push(entry);
		task.updatedAt = this.#options.at;
	}

	#close(
		id: string,
		status: TaskStatus,
		fields: { result?: string; left?: string; why?: string },
	): void {
		const task = this.#find(id);
		if (task === undefined || !isOpen(task) || task.status === status) return;
		this.#move(task, status);
		if (fields.result) task.result = fields.result;
		if (fields.left) task.left = fields.left;
		if (fields.why) task.why = fields.why;
	}

	#decide(text: string, tasks: readonly string[] | undefined): void {
		if (text === "" || this.#next.decisions.some((decision) => sameText(decision.text, text)))
			return;
		const known = (tasks ?? []).filter((id) => this.#find(id) !== undefined);
		this.#next.decisions.push({
			id: `d${this.#next.nextDecision++}`,
			text,
			origin: this.#options.origin,
			made: this.#mark,
			...(known.length > 0 ? { tasks: known } : {}),
		});
	}

	/** One of two tasks that say the same work goes. Done work always stays. */
	#merge(id: string, into: string): void {
		let gone = this.#find(id);
		let kept = this.#find(into);
		if (gone === undefined || kept === undefined || gone === kept) return;
		if (gone.status === "dropped" || kept.status === "dropped") return;
		if (gone.status === "done" && kept.status !== "done") [gone, kept] = [kept, gone];
		if (gone.status === "done") return;
		for (const entry of gone.asks) if (!kept.asks.includes(entry)) kept.asks.push(entry);
		if (gone.origin === "you") kept.origin = "you";
		this.#move(gone, "dropped");
		gone.why = `same as ${kept.id}`;
	}

	#find(id: string): Task | undefined {
		return this.#next.tasks.find((task) => task.id === id);
	}

	/** A task with the same words that is not dropped, which a new one would repeat. */
	#listed(text: string): Task | undefined {
		return this.#next.tasks.find((task) => task.status !== "dropped" && sameText(task.text, text));
	}

	#move(task: Task, status: TaskStatus): void {
		if (status === "doing" || status === "queued") {
			delete task.finished;
			// It did not finish after all, so its result goes with its close.
			delete task.result;
		}
		if (status !== "waiting") delete task.waitingOn;
		if (status === "doing" || status === "queued") delete task.why;
		if (status !== "queued") delete task.idleRuns;
		if (status === "doing" && task.status !== "doing") task.started = this.#mark;
		if (status === "done" || status === "dropped" || status === "deferred") {
			task.finished = this.#mark;
			if (status !== "done") delete task.left;
		}
		task.status = status;
		task.updatedAt = this.#options.at;
	}

	#add(text: string, status: TaskStatus, origin: Origin): Task {
		const task: Task = {
			id: `t${this.#next.nextTask++}`,
			text,
			status,
			origin,
			created: this.#mark,
			asks: [],
			updatedAt: this.#options.at,
		};
		if (status === "doing") task.started = this.#mark;
		this.#next.tasks.push(task);
		return task;
	}
}

function sameText(left: string, right: string): boolean {
	return wordsOf(left) === wordsOf(right);
}

function wordsOf(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}
