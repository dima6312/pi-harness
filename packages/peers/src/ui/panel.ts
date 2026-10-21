// The `Alt+G` panel: a tab per room this session is in, the folder's first, and `rooms` last. Each
// room keeps its own view, so a half-written line waits in its tab while you look at another.
import { type FrameTabs, hideImagesUnderOverlays } from "@adeildo/pi-kit";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import type { Room, RoomsView } from "../model.ts";
import { FRAME_MS } from "./motion.ts";
import { RoomView } from "./room.ts";
import { RoomsTab } from "./rooms.ts";

const TITLE = "Peers";
/** The key of the folder's room, whose id is undefined. */
const FOLDER = "";
/** The key of the `rooms` tab, which no room id can be. */
const ROOMS = "\u0000rooms";

export interface PanelOptions {
	theme: Theme;
	view: RoomsView;
	close: () => void;
	requestRender: () => void;
	rows: () => number;
	/** Injected so the docs pictures do not depend on when or where they are drawn. */
	now?: () => number;
	clock?: (at: number) => string;
}

export class PeersPanel implements Component, Focusable {
	focused = false;

	readonly #options: PanelOptions;
	readonly #rooms = new Map<string, RoomView>();
	readonly #manage: RoomsTab;
	/** The tab you are on, by room, so it stays put when rooms come and go around it. */
	#at = FOLDER;

	constructor(options: PanelOptions) {
		this.#options = options;
		const tabs = this.#tabs();
		this.#manage = new RoomsTab({
			theme: options.theme,
			view: options.view,
			session: options.view.here(undefined)?.session ?? "",
			title: TITLE,
			tabs,
			close: options.close,
			requestRender: options.requestRender,
			rows: options.rows,
		});
	}

	invalidate(): void {
		for (const room of this.#rooms.values()) room.invalidate();
		this.#manage.invalidate();
	}

	/** Whether something on the tab you are on moves, so the panel draws every frame. */
	moving(): boolean {
		const current = this.#current();
		return current instanceof RoomView && current.moving();
	}

	handleInput(data: string): void {
		this.#current().handleInput?.(data);
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const current = this.#current();
		return current instanceof RoomView ? current.handleMouse(event) : undefined;
	}

	render(width: number): string[] {
		const current = this.#current();
		current.focused = this.focused;
		return current.render(width);
	}

	/** The tab you are on; the folder's room when the one you were on is gone. */
	#current(): RoomView | RoomsTab {
		if (this.#at === ROOMS) return this.#manage;
		const rooms = this.#options.view.rooms();
		const room = rooms.find((one) => keyOf(one) === this.#at) ?? rooms[0];
		const view = room === undefined ? undefined : this.#roomView(room);
		if (room === undefined || view === undefined) {
			this.#at = ROOMS;
			return this.#manage;
		}
		this.#at = keyOf(room);
		return view;
	}

	#roomView(room: Room): RoomView | undefined {
		const key = keyOf(room);
		const kept = this.#rooms.get(key);
		if (kept !== undefined) return kept;
		const { view, theme } = this.#options;
		const here = view.here(room.id);
		if (here === undefined) return undefined;
		const made = new RoomView({
			theme,
			here,
			title: TITLE,
			room: room.id === undefined ? undefined : room.name,
			tabs: this.#tabs(),
			close: this.#options.close,
			requestRender: this.#options.requestRender,
			rows: this.#options.rows,
			now: this.#options.now,
			clock: this.#options.clock,
			send: (text) => view.send(room.id, text),
		});
		this.#rooms.set(key, made);
		return made;
	}

	#tabs(): { line: () => FrameTabs; switch: (delta: number) => void } {
		return {
			line: () => {
				const keys = this.#keys();
				return {
					titles: [...this.#options.view.rooms().map((room) => room.name), "rooms"],
					current: Math.max(0, keys.indexOf(this.#at)),
				};
			},
			switch: (delta) => {
				const keys = this.#keys();
				const at = Math.max(0, keys.indexOf(this.#at));
				this.#at = keys[(at + delta + keys.length) % keys.length] ?? FOLDER;
				this.#forgetLeft();
				this.#options.requestRender();
			},
		};
	}

	#keys(): string[] {
		return [...this.#options.view.rooms().map(keyOf), ROOMS];
	}

	/** A room this session left takes its unsent line with it. */
	#forgetLeft(): void {
		const kept = new Set(this.#keys());
		for (const key of this.#rooms.keys()) if (!kept.has(key)) this.#rooms.delete(key);
	}
}

function keyOf(room: Room): string {
	return room.id ?? FOLDER;
}

/** Opens the panel over the chat, on the folder's room. */
export async function openPanel(ctx: ExtensionContext, view: RoomsView): Promise<void> {
	if (ctx.mode !== "tui") return;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			hideImagesUnderOverlays(tui);
			// Every frame while something moves, otherwise once a second, and at once on any change.
			let quiet = 0;
			const ticks = setInterval(() => {
				quiet += FRAME_MS;
				if (!panel.moving() && quiet < 1_000) return;
				quiet = 0;
				tui.requestRender();
			}, FRAME_MS);
			const stop = view.onChange(() => tui.requestRender());
			const panel: PeersPanel = new PeersPanel({
				theme,
				view,
				rows: () => Math.floor(tui.terminal.rows * 0.8) - 1,
				requestRender: () => tui.requestRender(),
				close: () => {
					clearInterval(ticks);
					stop();
					done();
				},
			});
			return panel;
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "80%", minWidth: 60, maxHeight: "80%" },
		},
	);
}
