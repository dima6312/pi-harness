// Reading a V8 `.cpuprofile`: how much of a stretch of time was busy, and where that time went. The
// typing bench writes one profile per pi process, then asks these questions about the seconds it was
// typing, so a change to a render path can be judged against the same window before and after.

export interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	children?: readonly number[];
}

export interface Profile {
	startTime: number;
	endTime: number;
	nodes: ProfileNode[];
	samples: number[];
	/** Microseconds between one sample and the next, in the same order as `samples`. */
	timeDeltas: number[];
}

export interface Cost {
	/** `function the/last/parts/of/file:line`. */
	frame: string;
	ms: number;
}

export interface Report {
	/** Time the process was doing something, without the idle samples. */
	busyMs: number;
	/** Every sample in the window, idle ones included. */
	totalMs: number;
	/** Samples from the deepest frame up, counted once per frame on the path. */
	inclusive: Cost[];
}

interface Index {
	byId: Map<number, ProfileNode>;
	parent: Map<number, number>;
	/** Wall seconds from the profile start to each sample. */
	at: number[];
}

/** A profile is JSON with the shape above; anything missing simply reads as nothing. */
export function readProfile(text: string): Profile {
	const value = JSON.parse(text) as Partial<Profile>;
	return {
		startTime: value.startTime ?? 0,
		endTime: value.endTime ?? 0,
		nodes: value.nodes ?? [],
		samples: value.samples ?? [],
		timeDeltas: value.timeDeltas ?? [],
	};
}

export function frameName(node: ProfileNode): string {
	const name = node.callFrame.functionName === "" ? "(anon)" : node.callFrame.functionName;
	const where = node.callFrame.url.split("/").slice(-5).join("/");
	return `${name} ${where}:${node.callFrame.lineNumber}`;
}

export function report(profile: Profile, from: number, to: number): Report {
	const index = indexOf(profile);
	let busy = 0;
	let total = 0;
	const inclusive = new Map<string, number>();

	for (const [position, id] of profile.samples.entries()) {
		const when = index.at[position] ?? 0;
		if (when < from || when > to) continue;
		const micros = profile.timeDeltas[position] ?? 0;
		total += micros;
		const node = index.byId.get(id);
		if (node !== undefined && node.callFrame.functionName !== "(idle)") busy += micros;
		for (const frame of stackOf(index, id))
			inclusive.set(frame, (inclusive.get(frame) ?? 0) + micros);
	}

	return { busyMs: busy / 1000, totalMs: total / 1000, inclusive: ranked(inclusive) };
}

/** Under one frame, which of its children holds the time, `(self)` when the sample is the frame. */
export function under(profile: Profile, from: number, to: number, target: string): Cost[] {
	const index = indexOf(profile);
	const costs = new Map<string, number>();

	for (const [position, id] of profile.samples.entries()) {
		const when = index.at[position] ?? 0;
		if (when < from || when > to) continue;
		const micros = profile.timeDeltas[position] ?? 0;
		let current: number | undefined = id;
		let child: number | undefined;
		while (current !== undefined) {
			const node = index.byId.get(current);
			if (node === undefined) break;
			if (frameName(node) === target) {
				const below = child === undefined ? undefined : index.byId.get(child);
				const frame = below === undefined ? "(self)" : frameName(below);
				costs.set(frame, (costs.get(frame) ?? 0) + micros);
				break;
			}
			child = current;
			current = index.parent.get(current);
		}
	}

	return ranked(costs);
}

/** The frames of this repository, from the most expensive down. */
export function ours(costs: readonly Cost[]): Cost[] {
	return costs.filter((cost) => /[ /]packages\//.test(cost.frame));
}

function indexOf(profile: Profile): Index {
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const parent = new Map<number, number>();
	for (const node of profile.nodes) {
		for (const child of node.children ?? []) parent.set(child, node.id);
	}
	const at: number[] = [];
	let time = profile.startTime;
	for (const delta of profile.timeDeltas) {
		time += delta;
		at.push((time - profile.startTime) / 1e6);
	}
	return { byId, parent, at };
}

/** The frames a sample sits under, once each, deepest first: the inclusive view of that sample. */
function stackOf(index: Index, id: number): string[] {
	const frames: string[] = [];
	const seen = new Set<string>();
	let current: number | undefined = id;
	while (current !== undefined) {
		const node = index.byId.get(current);
		if (node === undefined) break;
		const frame = frameName(node);
		if (!seen.has(frame)) {
			seen.add(frame);
			frames.push(frame);
		}
		current = index.parent.get(current);
	}
	return frames;
}

function ranked(costs: Map<string, number>): Cost[] {
	return [...costs]
		.map(([frame, micros]) => ({ frame, ms: micros / 1000 }))
		.toSorted((a, b) => b.ms - a.ms);
}
