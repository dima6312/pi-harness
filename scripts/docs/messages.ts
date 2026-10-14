// The two voices of a session, drawn by pi's own components so a picture reads like the real thing.
import {
	AssistantMessageComponent,
	getMarkdownTheme,
	type Theme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

import { framed } from "../../packages/look/src/ui/user-message.ts";

/** Your message in the look's frame, across the width of the screen. */
export function userMessage(text: string, width: number, theme: Theme): string[] {
	const body = new UserMessageComponent(text, getMarkdownTheme(), 1).render(width - 2);
	return framed(body, width, theme, "\u{f007}");
}

export function assistantText(text: string, width: number): string[] {
	const message = new AssistantMessageComponent(
		{
			role: "assistant",
			content: [{ type: "text", text }],
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude-opus-5-5",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		} as never,
		false,
		getMarkdownTheme(),
		"thinking",
		0,
	);
	return message.render(width);
}
