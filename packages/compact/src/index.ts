import {
	createApp,
	currentTasks,
	defineFeature,
	describeTasks,
	type FeatureScope,
	modelsFor,
	type SessionTasks,
	tasksFromEntries,
} from "@adeildo/pi-kit";
import {
	type CustomMessageEntryDraft,
	estimateTokens,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { describeCall, KEEP_TURNS, pruneNow, sizeAfter } from "./prune.ts";
import {
	hiddenCalls,
	NOTE_MESSAGE,
	PRUNE_ENTRY,
	PruneEntry,
	type PruneRecord,
	recordOf,
	REREAD_ENTRY,
	type Spent,
	spentOn,
	tokens,
} from "./record.ts";
import {
	COMPACT_SETTINGS,
	model,
	prune,
	PRUNE_SECTION,
	pruneAbove,
	summary,
	SUMMARY_SECTION,
} from "./settings.ts";
import { summarize } from "./summary.ts";

export const compact = defineFeature({
	id: "compact",
	tab: "Compact",
	description:
		"Hides old tool output to keep the context small, and writes pi's compaction summary from the tasks",
	sections: [PRUNE_SECTION, SUMMARY_SECTION],
	settings: COMPACT_SETTINGS,
	setup(scope) {
		let forced = false;
		let hidden = new Set<string>();

		const restore = (ctx: ExtensionContext) => {
			hidden = hiddenCalls(ctx.sessionManager.getBranch());
		};
		scope.onSessionStart(restore);
		scope.on("session_tree", (_event, ctx) => restore(ctx));

		// Pi checks its own compaction right after turn_end, so pruning here usually spares it.
		scope.on("turn_end", (event, ctx) => {
			if (!forced && !prune.get(scope)) return undefined;
			const message = event.message;
			if (
				message.role !== "assistant" ||
				message.stopReason === "error" ||
				message.stopReason === "aborted"
			)
				return undefined;
			const { input, cacheRead, cacheWrite } = message.usage;
			const outputs = event.toolResults.reduce((sum, result) => sum + estimateTokens(result), 0);
			const before = input + cacheRead + cacheWrite + outputs;
			const asked = forced;
			forced = false;
			const plan = pruneNow(event.context.contextEntries, before, pruneAbove.get(scope), asked);
			if (plan === undefined) {
				if (asked)
					ctx.ui.notify(
						`Nothing to hide: no tool output is older than the last ${KEEP_TURNS} turns.`,
						"info",
					);
				return undefined;
			}
			const record: PruneRecord = {
				before,
				after: sizeAfter(plan, before),
				hidden: plan.hidden,
				...(asked ? { forced: true } : {}),
			};
			for (const { call } of plan.hidden) hidden.add(call);
			const tasks =
				currentTasks(scope.events)?.state ?? tasksFromEntries(ctx.sessionManager.getBranch());
			return {
				entries: [
					...event.entries,
					...plan.edits,
					note(tasks),
					{ type: "custom", customType: PRUNE_ENTRY, data: record },
				],
			};
		});

		scope.on("tool_call", (event) => {
			const call = describeCall(event.toolName, event.input);
			if (hidden.delete(call)) scope.appendEntry(REREAD_ENTRY, { call });
		});

		scope.on("session_before_compact", async (event, ctx) => {
			if (!summary.get(scope)) return undefined;
			const tasks = currentTasks(scope.events)?.state ?? tasksFromEntries(event.branchEntries);
			if (tasks.tasks.length === 0) return undefined;
			const { preparation } = event;
			const models = modelsFor(model.get(scope), ctx.modelRegistry, ctx.model);
			const request = {
				tasks,
				preparation,
				...(event.customInstructions ? { instructions: event.customInstructions } : {}),
			};
			const written = await summarize(request, models, ctx.modelRegistry, event.signal);
			return {
				compaction: {
					summary: written.summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					details: written.details,
					...(written.usage === undefined ? {} : { usage: written.usage }),
				},
			};
		});

		scope.registerCommand("prune", {
			description: "Hide old tool output at the end of the next turn, whatever the context's size",
			handler: async (_args, ctx) => {
				forced = true;
				ctx.ui.notify(`Old tool output goes at the end of the next turn.`, "info");
			},
		});

		scope.registerEntryRenderer<unknown>(PRUNE_ENTRY, (entry, { expanded }, theme) => {
			const record = recordOf(entry);
			return record === undefined ? undefined : new PruneEntry(record, expanded, theme);
		});

		registerScreen(scope);
	},
});

// Recites the tasks after a prune, so the agent keeps its goals.
function note(tasks: SessionTasks): CustomMessageEntryDraft {
	const parts = [
		"Older tool output was hidden to save context. Each placeholder names the call it came from: run it again if you need it.",
	];
	const stands = describeTasks(tasks, { done: 10, decisions: 10 });
	if (stands !== "") parts.push(`Where the session stands:\n${stands}`);
	return {
		type: "custom_message",
		customType: NOTE_MESSAGE,
		content: parts.join("\n\n"),
		display: false,
	};
}

function registerScreen(scope: FeatureScope): void {
	scope.screen.info({
		id: "compact.spent",
		section: PRUNE_SECTION,
		label: "This session",
		description: "What the prunes freed, and how many hidden outputs the agent ran again.",
		text: (ctx) => spentText(spentOn(ctx.sessionManager.getBranch())),
	});
}

export function spentText({ prunes, freed, hidden, rereads }: Spent): string {
	if (prunes === 0) return "nothing hidden yet";
	const times = prunes === 1 ? "1 prune" : `${prunes} prunes`;
	const share = hidden === 0 ? 0 : Math.round((rereads / hidden) * 100);
	return `${times} freed ${tokens(freed)} tokens; ${rereads} of ${hidden} hidden outputs run again (${share}%)`;
}

export default function piCompact(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-compact" }).use(compact).build();
}
