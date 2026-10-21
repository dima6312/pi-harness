// Who a shared room counts, folded from its `room.*` events. Every session folds the same lines in
// the same order, so every session agrees on who is in, the way they agree on who won a request.
import type { LoggedEvent, Member } from "@adeildo/pi-kit";

/** Who added a member, and why, as the room's first lines say it. */
export interface Addition {
	member: Member;
	/** The session that wrote it. */
	session: string;
	by: "you" | "agent";
	why?: string;
	allowedBy?: string;
	at: number;
}

export class Membership {
	name: string | undefined;
	createdAt: number | undefined;
	closed = false;
	/** Member folders, and when each was added. */
	readonly folders = new Map<string, number>();
	/** Sessions added by name, and where each works. */
	readonly sessions = new Map<string, string>();
	/** Sessions removed by name, kept out even while their folder is in. */
	readonly out = new Set<string>();
	/** Every addition, oldest first, for the line that says how the room came to be. */
	readonly additions: Addition[] = [];

	/** Folds one event. Anything but `room.*` is ignored. */
	apply(event: LoggedEvent): void {
		switch (event.type) {
			case "room.created": {
				const { name } = event.data as LoggedEvent<"room.created">["data"];
				this.name ??= name;
				this.createdAt ??= event.at;
				return;
			}
			case "room.added": {
				const data = event.data as LoggedEvent<"room.added">["data"];
				this.#add(data.member, event.at);
				this.additions.push({ ...data, session: event.session, at: event.at });
				return;
			}
			case "room.removed":
				return this.#remove((event.data as LoggedEvent<"room.removed">["data"]).member);
			case "room.closed":
				this.closed = true;
				return;
			default:
				return;
		}
	}

	/** Whether a session opened in `cwd` is in the room. */
	includes(session: string, cwd: string): boolean {
		if (this.closed || this.out.has(session)) return false;
		return this.sessions.has(session) || this.folders.has(cwd);
	}

	#add(member: Member, at: number): void {
		if ("folder" in member) {
			if (!this.folders.has(member.folder)) this.folders.set(member.folder, at);
			return;
		}
		this.out.delete(member.session);
		this.sessions.set(member.session, member.cwd);
	}

	#remove(member: Member): void {
		if ("folder" in member) {
			this.folders.delete(member.folder);
			return;
		}
		this.sessions.delete(member.session);
		this.out.add(member.session);
	}
}
