// The note you add when you approve a call reaches the agent as a message. In the transcript it is
// your words, framed like your messages and named after the call it went with.
import { drawnByWidth, ENTRY_X, entryFrame, type FeatureScope } from "@adeildo/pi-kit";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { NAME } from "#identity";

interface NoteDetails {
	toolName?: string;
}

export function registerNoteMessage(scope: FeatureScope): void {
	scope.registerMessageRenderer<NoteDetails>(NAME, (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		// The first line tells the agent what the note is; you wrote the rest.
		const note = content.slice(content.indexOf("\n") + 1).trim();
		const tool = message.details?.toolName ?? "the call";
		return drawnByWidth((width) =>
			entryFrame(
				wrapTextWithAnsi(note, Math.max(1, width - ENTRY_X)).map((line) => theme.fg("text", line)),
				width,
				theme,
				{
					top: `${theme.fg("muted", "you")} ${theme.fg("dim", `on approving ${tool}`)}`,
					color: "accent",
				},
			),
		);
	});
}
