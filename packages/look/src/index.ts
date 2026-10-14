import { dirname, join } from "node:path";

import {
	accountStateOf,
	createApp,
	currentPeers,
	currentTasks,
	defineFeature,
	drawSkillRefs,
	type FeatureScope,
	hideImagesUnderOverlays,
	SKILL_REF,
	skillNames,
} from "@adeildo/pi-kit";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { Key, type TUI } from "@earendil-works/pi-tui";

import { type GitState, readGit } from "./data/git.ts";
import { type GithubState, readGithub } from "./data/github.ts";
import { emptySnapshot, type LiveInputs, type Snapshot, SnapshotReader } from "./data/snapshot.ts";
import type { LastVisit } from "./data/start-notes.ts";
import { Telemetry } from "./data/telemetry.ts";
import type { DeltaKind } from "./data/telemetry.ts";
import { REQUEST_ENTRY, type RequestRecord } from "./data/totals.ts";
import { visit } from "./data/visits.ts";
import { type Glyphs, glyphsOf } from "./render/glyphs.ts";
import { PLAIN, themePaint } from "./render/paint.ts";
import { claimedStatuses, renderSegments, SEGMENTS } from "./render/segments.ts";
import {
	below,
	belowRight,
	bottomLeft,
	bottomRight,
	cursor,
	frame,
	gaugeCells,
	header,
	icons,
	labels,
	LOOK_SETTINGS,
	pathLength,
	peek,
	SECTIONS,
	SEPARATOR,
	strip,
	stripRight,
	topLeft,
	topRight,
	userFrame,
} from "./settings.ts";
import { applyCursor, LookEditor } from "./ui/editor.ts";
import { FooterComponent, StripComponent } from "./ui/footer.ts";
import { HARNESS_VERSION, HeaderComponent, type LoadedCounts } from "./ui/header.ts";
import { OutputView, outputsOf } from "./ui/outputs.ts";
import { framePiEntries } from "./ui/pi-entries.ts";
import { frameQueue } from "./ui/queue.ts";
import type { Screen, SlotName } from "./ui/screen.ts";
import { registerToolFrames } from "./ui/tool-frame.ts";
import { type Activity, describe, draftedTool } from "./ui/working.ts";

export { SEGMENT_IDS, SEGMENTS, type SegmentId } from "./render/segments.ts";
import type { SegmentId } from "./render/segments.ts";
export { ROLE_TOKENS } from "./render/paint.ts";

const STRIP_WIDGET = "pi-look:strip";
const TICK_MS = 500;
/** GitHub is asked once per process, however many sessions it opens. */
let probedGithub = false;

interface Live {
	ctx: ExtensionContext | undefined;
	footerData: ReadonlyFooterDataProvider | undefined;
	tui: TUI | undefined;
	repaint: (() => void) | undefined;
	git: GitState | undefined;
	github: GithubState | undefined;
	probing: boolean;
	ticker: ReturnType<typeof setInterval> | undefined;
	frame: Snapshot | undefined;
	activity: string | undefined;
}

export const look = defineFeature({
	id: "look",
	description:
		"The start screen, a framed editor, the footer and a working line that says what runs",
	sections: SECTIONS,
	settings: LOOK_SETTINGS,
	setup(scope) {
		const telemetry = new Telemetry();
		const reader = new SnapshotReader();
		const live: Live = {
			ctx: undefined,
			footerData: undefined,
			tui: undefined,
			repaint: undefined,
			git: undefined,
			github: undefined,
			probing: false,
			ticker: undefined,
			frame: undefined,
			activity: undefined,
		};

		const glyphs = glyphsOf(() => icons.get(scope));
		const screen = createScreen(scope, live, reader, telemetry, glyphs);
		registerToolFrames(scope);
		framePiEntries(() => {
			if (live.ctx === undefined) return undefined;
			return { theme: live.ctx.ui.theme, set: glyphs().set, you: userFrame.get(scope) };
		});
		frameQueue(() => live.ctx?.ui.theme);
		const repaint = () => {
			screen.bump();
			live.repaint?.();
		};

		for (const entry of LOOK_SETTINGS) entry.listen(scope, repaint);
		frame.listen(scope, () => live.ctx && installEditor(live.ctx, screen, live, scope));
		const visitsFile = join(dirname(scope.settings.globalPath), "look-visits.json");
		let visited = false;
		let lastVisit: LastVisit | undefined;

		scope.registerShortcut(Key.alt("o"), {
			description: "A tool call's whole output, to scroll; the arrows move between calls",
			handler: (ctx) => openOutputs(ctx),
		});

		scope.onSessionStart((ctx) => {
			live.ctx = ctx;
			telemetry.reset();
			void probeGit(live);
			if (ctx.mode !== "tui") return;

			ctx.ui.setFooter(
				(tui, _theme, data) =>
					new FooterComponent(tui, data, screen, {
						attach: (footerData, paint) => {
							live.footerData = footerData;
							// Everything that asks for a redraw says what the screen draws may have changed, which is
							// what a component that keeps its drawing for a moment compares.
							live.repaint = () => {
								screen.bump();
								paint();
							};
						},
						detach: () => {
							live.footerData = undefined;
							live.repaint = undefined;
						},
					}),
			);
			ctx.ui.setWidget(STRIP_WIDGET, () => new StripComponent(screen), {
				placement: "aboveEditor",
			});
			installEditor(ctx, screen, live, scope);
			// Once per launch: a new session in the same pi is not a return to the folder.
			if (!visited) {
				visited = true;
				lastVisit = visit(visitsFile, ctx.cwd, HARNESS_VERSION, Date.now());
			}
			// Once per launch, off the critical path: the card shows these lines when the answers arrive.
			if (!probedGithub) {
				probedGithub = true;
				void probeGithub(live, lastVisit?.at);
			}
			installHeader(
				ctx,
				screen,
				scope,
				() => lastVisit,
				() => live.github,
			);
		});

		scope.onShutdown(() => {
			stopTicking(live);
			const ctx = live.ctx;
			if (ctx?.mode === "tui") {
				ctx.ui.setFooter(undefined);
				ctx.ui.setWidget(STRIP_WIDGET, undefined);
				ctx.ui.setHeader(undefined);
				ctx.ui.setEditorComponent(undefined);
				ctx.ui.setWorkingMessage();
			}
			if (live.tui !== undefined) applyCursor(live.tui, "block");
			live.ctx = undefined;
			live.tui = undefined;
		});

		// These two fire for the calls the agent makes, and not for pi's cache warming, which calls the
		// provider on its own: the marks always belong to the answer being measured.
		scope.on("before_provider_request", () => telemetry.providerRequestSent());
		scope.on("after_provider_response", () => telemetry.providerResponseArrived());

		scope.on("agent_start", () => {
			telemetry.runStarted();
			setActivity(live, scope, { kind: "waiting" });
			startTicking(live);
		});

		scope.on("turn_start", () => {
			telemetry.requestStarted();
			setActivity(live, scope, { kind: "waiting" });
		});

		scope.on("message_start", (event) => {
			if (event.message.role === "assistant") telemetry.answerStarted();
		});

		scope.on("message_update", (event) => {
			const message = event.message;
			if (message.role !== "assistant") return;
			const update = event.assistantMessageEvent;
			const delta = "delta" in update ? update.delta : "";
			const kind: DeltaKind = update.type.startsWith("thinking") ? "thinking" : "writing";
			telemetry.answerGrew(delta, message.usage, kind);

			if (update.type === "thinking_start" || update.type === "thinking_delta") {
				setActivity(live, scope, { kind: "thinking" });
			} else if (update.type === "text_delta" || update.type === "text_start") {
				setActivity(live, scope, { kind: "writing" });
			} else if (update.type === "toolcall_start" || update.type === "toolcall_delta") {
				const tool = draftedTool(message.content);
				if (tool !== undefined) setActivity(live, scope, { kind: "drafting", tool });
			}
		});

		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const record = telemetry.answerEnded(event.message.usage);
			// Pi records usage without a duration, so the session keeps it for the speeds after a resume.
			if (record !== undefined) scope.appendEntry<RequestRecord>(REQUEST_ENTRY, record);
			repaint();
		});

		scope.on("tool_execution_start", (event) => {
			setActivity(live, scope, { kind: "running", tool: event.toolName });
		});

		scope.on("tool_execution_end", () => void probeGit(live));

		scope.on("agent_end", () => {
			telemetry.runEnded();
			stopTicking(live);
			live.activity = undefined;
			live.ctx?.ui.setWorkingMessage();
			repaint();
		});

		scope.on("agent_settled", () => void probeGit(live));
		scope.on("model_select", repaint);
		scope.on("thinking_level_select", repaint);
		scope.on("session_compact", repaint);
		scope.on("session_tree", repaint);

		scope.screen.action({
			id: "explain",
			section: "Appearance",
			label: "What is on screen",
			description: "Every piece around the editor right now, and what it means.",
			run: () => explain(screen),
		});
	},
});

const SLOT_TITLES: Record<SlotName, string> = {
	strip: "Above the editor, this answer",
	stripRight: "Above the editor, on the right",
	topLeft: "Frame, top left",
	topRight: "Frame, top right",
	bottomLeft: "Frame, bottom left",
	bottomRight: "Frame, bottom right",
	below: "Below the editor, the session",
	belowRight: "Below the editor, on the right",
};

function explain(screen: Screen): string {
	const snapshot = screen.snapshot();
	const paint = screen.paint();
	const lines: string[] = [paint.bold("What is on screen")];
	const groups: [string, readonly SegmentId[]][] = [
		...(Object.keys(SLOT_TITLES) as SlotName[]).map((name): [string, readonly SegmentId[]] => [
			SLOT_TITLES[name],
			screen.slot(name),
		]),
		// Not on screen: the timings of the last call, kept for when an answer feels slow.
		["The last call to the model", ["last", "wait", "speed", "server", "request"]],
	];
	for (const [title, ids] of groups) {
		if (ids.length === 0) continue;
		lines.push("", paint.role("brand", title));
		for (const id of ids) {
			const [piece] = renderSegments([id], {
				snapshot,
				glyphs: screen.glyphs(),
				paint,
				options: screen.options(),
			});
			const meaning = id.startsWith("status:")
				? `what ${id.slice("status:".length)} reports`
				: (SEGMENTS[id as keyof typeof SEGMENTS]?.describe ?? "");
			const shown = piece === undefined ? paint.dim("(nothing yet)") : piece.text;
			lines.push(`  ${shown}`, `    ${paint.dim(`${id}: ${meaning}`)}`);
		}
	}
	lines.push("", paint.dim("In is what was sent to the model, out is what came back."));
	return lines.join("\n");
}

function createScreen(
	scope: FeatureScope,
	live: Live,
	reader: SnapshotReader,
	telemetry: Telemetry,
	glyphs: () => Glyphs,
): Screen {
	// What the components that keep a drawing for a moment compare: an event, a probe, a new branch.
	let revision = 0;
	const slots: Record<SlotName, typeof strip> = {
		strip,
		stripRight,
		topLeft,
		topRight,
		bottomLeft,
		bottomRight,
		below,
		belowRight,
	};

	return {
		snapshot() {
			const ctx = live.ctx;
			if (ctx === undefined) return emptySnapshot();
			if (live.frame !== undefined) return live.frame;
			const snapshot = reader.read(ctx, {
				branch: live.footerData?.getGitBranch() ?? null,
				git: live.git,
				account: accountStateOf(scope.events, ctx.model?.provider),
				request: telemetry.request(),
				last: telemetry.last(),
				run: telemetry.run(),
				statuses: live.footerData?.getExtensionStatuses() ?? new Map(),
				...tasksOf(scope),
			});
			live.frame = snapshot;
			queueMicrotask(() => {
				live.frame = undefined;
			});
			return snapshot;
		},
		glyphs,
		revision: () => revision,
		bump: () => {
			revision++;
		},
		paint: (border) => (live.ctx === undefined ? PLAIN : themePaint(live.ctx.ui.theme, border)),
		separator: () => SEPARATOR,
		options: () => ({
			pathLength: pathLength.get(scope),
			gaugeCells: gaugeCells.get(scope),
			labels: labels.get(scope),
			claimed: claimedStatuses(Object.values(slots).map((entry) => entry.get(scope))),
		}),
		slot: (name) => slots[name].get(scope),
		frameStyle: () => frame.get(scope),
		cursor: () => cursor.get(scope),
		decorate: (line) => {
			const theme = live.ctx?.ui.theme;
			if (theme === undefined) return line;
			return drawSkillRefs(line, skillNames(scope.events), (name) =>
				theme.fg("customMessageLabel", `${SKILL_REF}${name}`),
			);
		},
		skills: () => skillNames(scope.events).length > 0,
	};
}

function tasksOf(scope: FeatureScope): Pick<LiveInputs, "tasks" | "peers" | "peersUnread"> {
	const peers = currentPeers(scope.events);
	return {
		tasks: currentTasks(scope.events)?.state,
		peers: peers?.peers,
		peersUnread: peers?.unread,
	};
}

function installEditor(
	ctx: ExtensionContext,
	screen: Screen,
	live: Live,
	scope: FeatureScope,
): void {
	if (ctx.mode !== "tui") return;
	if (frame.get(scope) === "off") {
		ctx.ui.setEditorComponent(undefined);
		return;
	}
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		live.tui = tui;
		applyCursor(tui, cursor.get(scope));
		return new LookEditor(tui, theme, keybindings, screen);
	});
}

function installHeader(
	ctx: ExtensionContext,
	screen: Screen,
	scope: FeatureScope,
	lastVisit: () => LastVisit | undefined,
	github: () => GithubState | undefined,
): void {
	if (ctx.mode !== "tui") return;
	if (header.get(scope) === "off") {
		ctx.ui.setHeader(undefined);
		return;
	}
	ctx.ui.setHeader(
		(tui) =>
			new HeaderComponent(
				screen,
				{
					style: () => header.get(scope),
					counts: () => loadedCounts(scope),
					lastVisit,
					github,
				},
				tui,
			),
	);
}

function loadedCounts(pi: ExtensionAPI): LoadedCounts {
	const commands = pi.getCommands();
	const extensions = new Set<string>();
	for (const command of commands) {
		if (command.source === "extension") extensions.add(command.sourceInfo.path);
	}
	for (const tool of pi.getAllTools()) {
		const source = tool.sourceInfo.source;
		if (source !== "builtin" && source !== "sdk") extensions.add(tool.sourceInfo.path);
	}
	return {
		tools: pi.getActiveTools().length,
		skills: commands.filter((command) => command.source === "skill").length,
		prompts: commands.filter((command) => command.source === "prompt").length,
		extensions: extensions.size,
	};
}

function setActivity(live: Live, scope: FeatureScope, activity: Activity): void {
	if (!peek.get(scope)) return;
	const message = describe(activity);
	if (message === live.activity) return;
	live.activity = message;
	live.ctx?.ui.setWorkingMessage(message);
}

async function probeGithub(live: Live, since: number | undefined): Promise<void> {
	const ctx = live.ctx;
	if (ctx === undefined) return;
	const github = await readGithub(ctx.cwd, since);
	if (live.ctx === undefined) return;
	live.github = github;
	// The card keeps its drawing for a second; this is the redraw that makes the new lines appear.
	live.repaint?.();
}

async function probeGit(live: Live): Promise<void> {
	const ctx = live.ctx;
	if (ctx === undefined || live.probing) return;
	live.probing = true;
	try {
		live.git = await readGit(ctx.cwd);
		live.repaint?.();
	} finally {
		live.probing = false;
	}
}

function startTicking(live: Live): void {
	stopTicking(live);
	live.ticker = setInterval(() => live.repaint?.(), TICK_MS);
	live.ticker.unref?.();
}

function stopTicking(live: Live): void {
	if (live.ticker === undefined) return;
	clearInterval(live.ticker);
	live.ticker = undefined;
}

export default function piLook(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-look" }).use(look).build();
}

/** Alt+O: the session's tool output, one call at a time, newest first. */
async function openOutputs(ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") return;
	const outputs = outputsOf(ctx.sessionManager.getBranch());
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			hideImagesUnderOverlays(tui);
			return new OutputView({
				theme,
				outputs,
				rows: () => Math.floor(tui.terminal.rows * 0.85),
				close: () => done(),
			});
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "85%" },
		},
	);
}
