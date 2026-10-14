import {
	createApp,
	currentTasks,
	defineFeature,
	describeTasks,
	type FeatureScope,
	modelsFor,
	type SessionTasks,
	tasksFromEntries,
	drawnByWidth,
	formatTokens,
} from "@adeildo/pi-kit";
import {
	type CustomMessageEntryDraft,
	estimateTokens,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionBoundaryDraft,
	type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
	copiedPrune,
	describeCall,
	KEEP_TURNS,
	planServerClear,
	pruneNow,
	sizeAfter,
} from "./prune.ts";
import {
	type Billed,
	clearedEntries,
	hiddenCalls,
	lastPromptOf,
	NOTE_MESSAGE,
	PRUNE_ENTRY,
	priced,
	PruneEntry,
	type PruneRecord,
	recordOf,
	REREAD_ENTRY,
	type Spent,
	spentOn,
} from "./record.ts";
import { clearsOnServer, KEEP_TOOL_USES, serverCleared, withServerClearing } from "./server.ts";
import {
	COMPACT_SETTINGS,
	model,
	onServer,
	prune,
	PRUNE_SECTION,
	pruneAbove,
	summary,
	SUMMARY_SECTION,
} from "./settings.ts";
import { summarize } from "./summary.ts";

/** Past this share of the model's window a turn prunes at once, before pi's own compaction. */
const NEAR_WINDOW = 0.8;

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
		let cleared = new Set<string>();
		let lastPrompt: number | undefined;

		const restore = (ctx: ExtensionContext) => {
			const branch = ctx.sessionManager.getBranch();
			hidden = hiddenCalls(branch);
			cleared = clearedEntries(branch);
			lastPrompt = lastPromptOf(branch);
		};
		scope.onSessionStart(restore);
		scope.on("session_tree", (_event, ctx) => restore(ctx));
		scope.on("session_compact", () => {
			lastPrompt = undefined;
		});

		const onServerFor = (ctx: ExtensionContext) =>
			prune.get(scope) && onServer.get(scope) && clearsOnServer(ctx.model);

		scope.on("before_provider_request", (event, ctx) =>
			onServerFor(ctx) ? withServerClearing(event.payload, pruneAbove.get(scope)) : undefined,
		);

		/** The last answer's usage, measured at the end of the run. */
		let lastUsage: Billed | undefined;

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
			const prompt = input + cacheRead + cacheWrite;
			const previous = lastPrompt;
			lastPrompt = prompt;
			lastUsage = message.usage;
			if (!forced && onServerFor(ctx)) {
				if (previous === undefined || !serverCleared(previous, prompt, pruneAbove.get(scope)))
					return undefined;
				return {
					entries: [...event.entries, ...clearedOnServer(event, ctx, previous, message.usage)],
				};
			}
			// A prune makes the next request write the whole prompt again. At the end of the run that
			// lands on your next message, which pays it anyway when the cache went cold. Mid-run only
			// when pi's own compaction is close, which a prune here usually spares.
			const window = ctx.model?.contextWindow ?? 0;
			if (forced || window === 0 || prompt < NEAR_WINDOW * window) return undefined;
			const outputs = event.toolResults.reduce((sum, result) => sum + estimateTokens(result), 0);
			return pruneNowAt(
				event.entries,
				event.context.contextEntries,
				prompt + outputs,
				message.usage,
				ctx,
			);
		});

		scope.on("agent_before_settle", (event, ctx) => {
			const usage = lastUsage;
			lastUsage = undefined;
			if (event.outcome !== "completed" || usage === undefined) return undefined;
			if (!forced && (!prune.get(scope) || onServerFor(ctx))) return undefined;
			const before = usage.input + usage.cacheRead + usage.cacheWrite;
			return pruneNowAt(event.entries, event.context.contextEntries, before, usage, ctx);
		});

		/** Hides old output if it pays, or always after /prune, and records what it hid. */
		function pruneNowAt(
			entries: readonly SessionBoundaryDraft[],
			context: TurnEndEvent["context"]["contextEntries"],
			before: number,
			usage: Billed,
			ctx: ExtensionContext,
		): { entries: SessionBoundaryDraft[] } | undefined {
			const asked = forced;
			forced = false;
			const plan = pruneNow(context, before, pruneAbove.get(scope), asked);
			if (plan === undefined) {
				if (asked)
					ctx.ui.notify(
						`Nothing to hide: no tool output is older than the last ${KEEP_TURNS} turns.`,
						"info",
					);
				return undefined;
			}
			const after = sizeAfter(plan, before);
			const cost = priced(
				usage,
				ctx.model?.cost.cacheRead ?? 0,
				before - after,
				// Only the system prompt stays cached, so the next request writes all of this again.
				after,
			);
			const record: PruneRecord = {
				before,
				after,
				hidden: plan.hidden,
				...(asked ? { forced: true } : {}),
				...cost,
			};
			for (const { call } of plan.hidden) hidden.add(call);
			// The next request is smaller for the edit, not for a server clear.
			lastPrompt = undefined;
			return {
				entries: [
					...entries,
					...plan.edits,
					note(tasksNow(ctx), false),
					{ type: "custom", customType: PRUNE_ENTRY, data: record },
				],
			};
		}

		scope.on("tool_call", (event) => {
			const copied = copiedPrune(event.input);
			if (copied !== undefined)
				return {
					block: true,
					reason: `Not run: its arguments carry ${copied}, copied from an old call whose arguments left the context. Write every argument out in full.`,
				};
			const call = describeCall(event.toolName, event.input);
			if (hidden.delete(call)) scope.appendEntry(REREAD_ENTRY, { call });
			return undefined;
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
			const compaction = await summarize(request, models, ctx.modelRegistry, event.signal);
			return compaction === undefined ? undefined : { compaction };
		});

		scope.registerCommand("prune", {
			description: "Hide old tool output when this run ends, whatever the context's size",
			handler: async (_args, ctx) => {
				forced = true;
				ctx.ui.notify(
					onServerFor(ctx)
						? "Old tool output goes when this run ends. On Anthropic models this edit drops the agent's earlier thinking, which Anthropic's own clearing keeps."
						: "Old tool output goes when this run ends. The edit drops the agent's earlier thinking.",
					"info",
				);
			},
		});

		scope.registerEntryRenderer<unknown>(PRUNE_ENTRY, (entry, { expanded }, theme) => {
			const record = recordOf(entry);
			if (record === undefined) return undefined;
			const card = new PruneEntry(record, expanded, theme);
			return drawnByWidth((width) => card.render(width));
		});

		registerScreen(scope);

		/** Records what Anthropic cleared on the request that just answered, and recites the tasks. */
		function clearedOnServer(
			event: TurnEndEvent,
			ctx: ExtensionContext,
			previous: number,
			usage: Billed,
		): SessionBoundaryDraft[] {
			const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
			const entries = event.context.contextEntries;
			const end = entries.findIndex((item) => item.sourceEntry.id === event.messageEntryId);
			const plan = planServerClear(
				end === -1 ? entries : entries.slice(0, end),
				KEEP_TOOL_USES,
				cleared,
			);
			for (const { entry, call } of plan.hidden) {
				cleared.add(entry);
				hidden.add(call);
			}
			const record: PruneRecord = {
				before: previous,
				after: prompt,
				hidden: plan.hidden,
				server: true,
				...priced(usage, ctx.model?.cost.cacheRead ?? 0, previous - prompt, usage.cacheWrite),
			};
			return [note(tasksNow(ctx), true), { type: "custom", customType: PRUNE_ENTRY, data: record }];
		}

		function tasksNow(ctx: ExtensionContext): SessionTasks {
			return currentTasks(scope.events)?.state ?? tasksFromEntries(ctx.sessionManager.getBranch());
		}
	},
});

// Recites the tasks after a prune or a clear, so the agent keeps its goals.
function note(tasks: SessionTasks, server: boolean): CustomMessageEntryDraft {
	const parts = [
		server
			? "Anthropic cleared older tool output to save context. The calls are still there: run one again if you need its output."
			: "Older tool output was hidden to save context. Each placeholder names the call it came from: run it again if you need it.",
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
	return `${times} freed ${formatTokens(freed)} tokens; ${rereads} of ${hidden} hidden outputs run again (${share}%)`;
}

export default function piCompact(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-compact" }).use(compact).build();
}
