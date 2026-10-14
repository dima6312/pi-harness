import {
	answerTasks,
	modelsFor,
	createApp,
	defineFeature,
	TASKS_CHANGED,
	TASKS_SETTLED,
	TASKS_STATE,
	tasksSpent,
	tasksWith,
	logFrom,
	hideImagesUnderOverlays,
	GLYPH,
} from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { Keeper } from "./keeper.ts";
import { registerScreen, sessionSection } from "./screen.ts";
import { model, nameSession, SETTINGS_SECTION, TASKS_SETTINGS } from "./settings.ts";
import { type SkillNote, withSkills, yourWords } from "./transcript.ts";
import { Updates } from "./updates.ts";
import { TasksView } from "./view.ts";

/** The look draws this status as its tasks segment. */
export const TASKS_STATUS = "pi-tasks";

export const tasks = defineFeature({
	id: "tasks",
	tab: "Tasks",
	description: "Keeps what the session is doing, what it did, what waits and what was decided",
	sections: (ctx) => [sessionSection(ctx), SETTINGS_SECTION],
	settings: TASKS_SETTINGS,
	setup(scope) {
		let session: ExtensionContext | undefined;
		let titled: string | undefined;
		// What the log last got, so it only gets what changed.
		let loggedAt: number | undefined;
		let loggedName: string | undefined;
		const keeper = new Keeper(
			(customType, data) => scope.appendEntry(customType, data),
			(trigger) => {
				if (trigger !== "tidy") updates.changed();
				name();
				show();
			},
		);
		const updates = new Updates(keeper, {
			models: (ctx) => modelsFor(model.get(scope), ctx.modelRegistry, ctx.model),
			settled: () => scope.events.emit(TASKS_SETTLED, {}),
			explain: (text) => withSkills(text, skillsOf(scope)),
		});

		function show(): void {
			const state = keeper.state();
			const doing = tasksWith(state, "doing");
			const first = doing[0]?.text ?? state.title;
			const more = doing.length > 1 ? ` +${doing.length - 1}` : "";
			session?.ui.setStatus(
				TASKS_STATUS,
				first === undefined ? undefined : `${GLYPH.triangle} ${first}${more}`,
			);
			scope.events.emit(TASKS_CHANGED, state);
			if (session !== undefined && state.updatedAt !== loggedAt) {
				loggedAt = state.updatedAt;
				logFrom(session, scope.events, "tasks.changed", { state });
			}
		}

		function name(): void {
			const { title } = keeper.state();
			const next = nameFor(title, titled, scope.getSessionName());
			if (next !== undefined && nameSession.get(scope)) scope.setSessionName(next);
			titled = title;
			const { handle } = keeper.state();
			if (session === undefined || handle === undefined || title === undefined) return;
			if (`${handle} ${title}` === loggedName) return;
			loggedName = `${handle} ${title}`;
			logFrom(session, scope.events, "session.named", { handle, title });
		}

		function restore(ctx: ExtensionContext): void {
			keeper.restore(ctx.sessionManager.getBranch());
			// A session titled before it could be named gets its name now.
			titled = undefined;
			loggedAt = undefined;
			loggedName = undefined;
			name();
			updates.reset();
			show();
		}

		scope.onSessionStart((ctx) => {
			session = ctx;
			updates.start();
			restore(ctx);
		});
		scope.on("session_tree", (_event, ctx) => restore(ctx));
		scope.onShutdown(() => {
			updates.stop();
			session = undefined;
		});

		scope.events.on(TASKS_STATE, (data: unknown) =>
			answerTasks(data, keeper.state(), { pending: updates.pending, working: updates.working }),
		);

		scope.on("agent_start", (_event, ctx) => {
			if (ctx.hasUI) updates.runStarted(ctx);
		});

		// A steer counts once the agent reads it, not when you type it. Your answers to the agent's
		// questions end as a tool's result, and count the same.
		scope.on("message_end", (event, ctx) => {
			if (!ctx.hasUI) return;
			const text = yourWords(event.message);
			if (text !== undefined) updates.message(ctx, text);
		});

		scope.on("agent_settled", (_event, ctx) => {
			if (ctx.hasUI) updates.runEnded(ctx);
		});

		registerScreen(scope, keeper);

		scope.registerShortcut(Key.alt("t"), {
			description: "The session's tasks: doing, waiting, queued, done and decided",
			handler: (ctx) => openTasks(ctx),
		});

		async function openTasks(ctx: ExtensionContext): Promise<void> {
			if (ctx.mode !== "tui") return;
			let stopWatching: (() => void) | undefined;
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					hideImagesUnderOverlays(tui);
					stopWatching = scope.events.on(TASKS_CHANGED, () => tui.requestRender());
					return new TasksView({
						theme,
						state: () => keeper.state(),
						spent: () => tasksSpent(ctx.sessionManager.getBranch()),
						rows: () => Math.floor(tui.terminal.rows * 0.8) - 1,
						close: () => done(),
						requestRender: () => tui.requestRender(),
						// What you do here is yours, and joins the tasks under way instead of pushing them aside.
						act: (op) => keeper.apply([op], "you", { busy: true }),
					});
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%" },
				},
			);
			stopWatching?.();
		}
	},
});

export default function piTasks(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-tasks" }).use(tasks).build();
}

function skillsOf(pi: Pick<ExtensionAPI, "getCommands">): SkillNote[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => ({
			name: command.name.replace(/^skill:/, ""),
			description: command.description,
		}));
}

/** The session follows its title while it has no name, or still has the one the title gave it. */
export function nameFor(
	title: string | undefined,
	before: string | undefined,
	current: string | undefined,
): string | undefined {
	if (title === undefined || title === before) return undefined;
	return current === undefined || current === before ? title : undefined;
}
