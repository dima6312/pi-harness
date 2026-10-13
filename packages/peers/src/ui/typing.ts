// Over the editor, while another agent writes to the room: who, to whom, and the words as they arrive.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Typing } from "../here.ts";
import { byHandle, type Named } from "../names.ts";
import { dots, FRAME_MS, spin } from "./motion.ts";

export const PEERS_TYPING = "pi-peers-typing";

export interface TypingSource {
	readonly session: string | undefined;
	othersTyping(): Typing[];
	names(): ReadonlyMap<string, Named>;
}

export function typingLines(
	typing: readonly Typing[],
	source: Pick<TypingSource, "session" | "names">,
	theme: Theme,
	width: number,
	now: number,
): string[] {
	const names = source.names();
	// A message to this session reads "to you".
	const me = source.session === undefined ? undefined : names.get(source.session)?.handle;
	return typing.map((one) => {
		const named = names.get(one.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		const head = `${theme.fg(color, spin(now))} ${theme.fg(color, theme.bold(named?.handle ?? "an agent"))} ${theme.fg("dim", "is writing to")} ${typingRecipients(one.to, names, theme, me)}${theme.fg("dim", dots(now))}`;
		const words = one.text.replaceAll(/\s+/g, " ").trim();
		if (words === "") return truncateToWidth(head, width, "...");
		const room = width - visibleWidth(head) - 3;
		if (room < 12) return truncateToWidth(head, width, "...");
		// The newest words matter most while they arrive, so a long draft keeps its end.
		const shown = words.length > room ? `...${words.slice(words.length - room + 3)}` : words;
		return `${head}   ${theme.fg("muted", shown)}`;
	});
}

/** Redraws itself every frame while someone writes; pi drops it when nobody does. */
export class TypingWidget implements Component {
	readonly #source: TypingSource;
	readonly #theme: Theme;
	readonly #ticks: ReturnType<typeof setInterval>;

	constructor(source: TypingSource, theme: Theme, requestRender: () => void) {
		this.#source = source;
		this.#theme = theme;
		this.#ticks = setInterval(requestRender, FRAME_MS);
	}

	render(width: number): string[] {
		return typingLines(this.#source.othersTyping(), this.#source, this.#theme, width, Date.now());
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.#ticks);
	}
}

/** Who a draft goes to, each in its color; `me` reads "you". */
export function typingRecipients(
	to: string,
	names: ReadonlyMap<string, Named>,
	theme: Theme,
	me?: string,
): string {
	if (to === "everyone") return theme.fg("muted", "everyone");
	return to
		.split(",")
		.map((part) => part.trim().replace(/^@/, ""))
		.filter((handle) => handle !== "")
		.map((handle) => {
			if (handle === me) return theme.fg("accent", "you");
			const named = byHandle(names, handle);
			return theme.fg((named?.color ?? "muted") as ThemeColor, handle);
		})
		.join(theme.fg("dim", ", "));
}
