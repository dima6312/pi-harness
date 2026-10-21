// The other sessions this one works with, as the footer and any other viewer draw them.
import { defineContract } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";

/** Another session in the folder, as every viewer should draw it. */
export interface PeerMark {
	handle: string;
	/** A theme color name, so a peer looks the same in the footer, the room and the board. */
	color: string;
	state: "running" | "idle" | "waiting";
	/** The shared room it is in with this session, absent for the folder's room. */
	room?: string;
}

export interface PeersState {
	peers: PeerMark[];
	/** Messages a peer sent to this session that its agent has not read yet. */
	unread: number;
}

export const PEERS = defineContract<PeersState>(
	"peers",
	guarded(isPeersState, "a list of peers and an unread count"),
);

const STATES = new Set(["running", "idle", "waiting"]);

function isPeersState(value: unknown): value is PeersState {
	if (!isObject(value) || typeof value.unread !== "number") return false;
	return Array.isArray(value.peers) && value.peers.every(isPeerMark);
}

function isPeerMark(value: unknown): value is PeerMark {
	if (!isObject(value) || typeof value.handle !== "string" || typeof value.color !== "string")
		return false;
	return typeof value.state === "string" && STATES.has(value.state);
}
