// What a session is called and painted with. Both come from the folder's logs, so every session
// shows the same name in the same color, and a name stays put while it is open.
import type { Peer } from "./folder.ts";

/**
 * Theme colors with distinct hues in dark and light themes alike. The footer already uses warning,
 * success, error and accent for what it says, so a peer never wears one of those.
 */
export const PEER_COLORS = [
	"syntaxKeyword",
	"syntaxString",
	"syntaxVariable",
	"syntaxType",
	"syntaxNumber",
] as const;

export type PeerColor = (typeof PEER_COLORS)[number];

export interface Named {
	session: string;
	handle: string;
	color: PeerColor;
}

/**
 * Names for the open sessions, oldest first. A name two sessions share gets a number on the
 * newer one, and a session not titled yet is `new` and the end of its id.
 */
export function namesOf(live: readonly Peer[]): Map<string, Named> {
	const names = new Map<string, Named>();
	const taken = new Set<string>();
	const used = new Set<PeerColor>();
	for (const peer of live) {
		const base = peer.handle ?? `new-${peer.session.slice(-4)}`;
		let handle = base;
		for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
		taken.add(handle);
		const color = colorFor(peer.session, used);
		used.add(color);
		names.set(peer.session, { session: peer.session, handle, color });
	}
	return names;
}

/** The session's own color, or the next free one when an older open session has it. */
function colorFor(session: string, used: ReadonlySet<PeerColor>): PeerColor {
	const start = hash(session) % PEER_COLORS.length;
	for (let step = 0; step < PEER_COLORS.length; step++) {
		const color = PEER_COLORS[(start + step) % PEER_COLORS.length] ?? "syntaxKeyword";
		if (!used.has(color)) return color;
	}
	return PEER_COLORS[start] ?? "syntaxKeyword";
}

function hash(text: string): number {
	let value = 0;
	for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
	return value;
}

/** The open session a name points at, ignoring case and a leading @. */
export function byHandle(names: ReadonlyMap<string, Named>, name: string): Named | undefined {
	const wanted = name.replace(/^@/, "").toLowerCase();
	return [...names.values()].find((named) => named.handle === wanted);
}

/** Every @name in a text that points at an open session. */
export function mentionsIn(names: ReadonlyMap<string, Named>, text: string): Named[] {
	const found = new Map<string, Named>();
	for (const match of text.matchAll(/(?<![\w@])@([a-z][a-z0-9-]*)/gi)) {
		const named = byHandle(names, match[1] ?? "");
		if (named !== undefined) found.set(named.session, named);
	}
	return [...found.values()];
}
