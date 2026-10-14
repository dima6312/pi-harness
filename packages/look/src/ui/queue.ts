// The messages you send while the agent works wait in a dashed frame above the editor: dashed
// because they have not happened yet. Each says when it goes in, `steer` between the agent's calls
// and `next` after its run, and the bottom edge names the key that takes them back to the editor.
// Pi lists them as plain grey lines and has no hook for drawing them, so this wraps its method.
import { drawnByWidth, ENTRY_X, entryFrame, GLYPH } from "@adeildo/pi-kit";
import { InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The theme to draw with. Undefined leaves pi's list as it is. */
export type QueuePaint = () => Theme | undefined;

interface Queued {
	steering: readonly string[];
	followUp: readonly string[];
}

interface Host {
	pendingMessagesContainer: { clear(): void; addChild(component: Component): void };
	getAllQueuedMessages(): Queued;
	getAppKeyDisplay(action: string): string;
}

let installed = false;
let paint: QueuePaint = () => undefined;

export function frameQueue(source: QueuePaint): void {
	paint = source;
	if (installed) return;
	installed = true;
	const prototype = InteractiveMode.prototype as unknown as {
		updatePendingMessagesDisplay(): void;
	};
	const own = prototype.updatePendingMessagesDisplay;
	prototype.updatePendingMessagesDisplay = function update(this: Host) {
		const theme = paint();
		if (theme === undefined) return own.call(this);
		const queued = this.getAllQueuedMessages();
		this.pendingMessagesContainer.clear();
		if (queued.steering.length + queued.followUp.length === 0) return;
		const key = this.getAppKeyDisplay("app.message.dequeue");
		this.pendingMessagesContainer.addChild(queueBlock(queued, key, theme));
	};
}

const MODES = [
	["steer", "steering"],
	["next", "followUp"],
] as const;
const LABEL = Math.max(...MODES.map(([label]) => label.length));

export function queueBlock(queued: Queued, key: string, theme: Theme): Component {
	return drawnByWidth((width) => {
		const room = Math.max(1, width - ENTRY_X - LABEL - 2);
		const rows = MODES.flatMap(([label, mode]) =>
			queued[mode].map((text) => {
				const color = label === "steer" ? "accent" : "muted";
				return `${theme.fg(color, label.padEnd(LABEL))}  ${theme.fg("text", oneLine(text, room))}`;
			}),
		);
		return entryFrame(rows, width, theme, {
			top: theme.fg("dim", "queued"),
			bottom: `${theme.fg("muted", key)} ${theme.fg("dim", "to edit")}`,
			color: "borderMuted",
			dashed: true,
		});
	});
}

/** The first line, cut to the room, with a mark when there is more. */
function oneLine(text: string, room: number): string {
	const lines = text.trim().split("\n");
	const first = lines[0] ?? "";
	if (lines.length === 1 && visibleWidth(first) <= room) return first;
	return `${truncateToWidth(first, Math.max(1, room - 1), "")}${GLYPH.ellipsis}`;
}
