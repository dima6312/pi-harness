// The judge's intent: the session and what it is doing in your words, and your last message.
import { currentTasks, intentOf, tasksSettled } from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isRecord } from "#util/primitives.ts";

/** How long the judge waits for the tasks to take in your last message. */
const TASKS_WAIT_MS = 3000;

export async function intentFor(
	ctx: Pick<ExtensionContext, "sessionManager">,
	events: ExtensionAPI["events"],
): Promise<string | undefined> {
	const last = currentIntent(ctx);
	if (currentTasks(events) === undefined) return last;
	await tasksSettled(events, TASKS_WAIT_MS);

	const tasks = currentTasks(events)?.state;
	const parts: string[] = [];
	const ours = tasks === undefined ? undefined : intentOf(tasks);
	if (ours !== undefined) parts.push(ours);
	if (last !== undefined) parts.push(`Last message: ${last}`);
	return parts.length === 0 ? undefined : parts.join("\n");
}

export function currentIntent(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	const branch: readonly unknown[] = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const text = userText(branch[index]);
		if (text !== undefined) return text;
	}
	return undefined;
}

function userText(entry: unknown): string | undefined {
	if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return undefined;
	if (entry.message.role !== "user") return undefined;

	return contentText(entry.message.content).trim() || undefined;
}

/** A message holds a string, or parts where only the text ones say anything. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const texts: string[] = [];
	for (const part of content) {
		if (isRecord(part) && part.type === "text" && typeof part.text === "string")
			texts.push(part.text);
	}
	return texts.join("\n");
}
