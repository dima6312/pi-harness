import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

export const PEERS_STATE = "harness:peers";

/** Another session in the folder, as every viewer should draw it. */
export interface PeerMark {
	handle: string;
	/** A theme color name, so a peer looks the same in the footer, the room and the board. */
	color: string;
	state: "running" | "idle" | "waiting";
}

export interface PeersProbe {
	peers?: PeerMark[];
	/** Messages a peer sent to this session that its agent has not read yet. */
	unread?: number;
}

export function currentPeers(events: ExtensionAPI["events"]): PeersProbe | undefined {
	const probe: PeersProbe = {};
	events.emit(PEERS_STATE, probe);
	return probe.peers === undefined ? undefined : probe;
}

export function answerPeers(data: unknown, peers: PeerMark[], unread: number): void {
	if (!isObject(data)) return;
	data.peers = peers;
	data.unread = unread;
}
