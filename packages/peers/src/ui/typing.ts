// Over the editor, while another agent writes to the room: who, to whom, and the words as they
// arrive. A draft has not happened yet, so it wears the dashed frame the send queue wears.
import { ENTRY_X, entryFrame, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";

import type { Typing } from "../here.ts";
import { EVERYONE_MENTION } from "../mention.ts";
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
	return typing.flatMap((one) => {
		const named = names.get(one.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		// The newest words matter most while they arrive, so a long draft keeps its end.
		const words = one.text.replaceAll(/\s+/g, " ").trim();
		const room = Math.max(1, width - ENTRY_X - 4);
		const body =
			words === ""
				? []
				: [theme.fg("muted", words.length > room ? `...${words.slice(-room)}` : words)];
		return entryFrame(body, width, theme, {
			top: `${theme.fg(color, theme.bold(`@${named?.handle ?? "an agent"}`))}${theme.fg("dim", ` ${GLYPH.right} `)}${typingRecipients(one.to, names, theme, me)}`,
			topRight: `${theme.fg(color, spin(now))} ${theme.fg("dim", `writing${dots(now)}`)}`,
			color,
			dashed: true,
		});
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
	if (to === EVERYONE_MENTION) return theme.fg("muted", EVERYONE_MENTION);
	return to
		.split(",")
		.map((part) => part.trim().replace(/^@/, ""))
		.filter((handle) => handle !== "")
		.map((handle) => {
			if (handle === me) return theme.fg("accent", "you");
			const named = byHandle(names, handle);
			return theme.fg((named?.color ?? "muted") as ThemeColor, `@${handle}`);
		})
		.join(theme.fg("dim", ", "));
}
