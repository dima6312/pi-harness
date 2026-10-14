// The environment the bench runs pi in. It gets an event log of its own, so a bench session never
// shows up in the room of the folder it measures, and a CPU profile in the same temporary directory.
import { join } from "node:path";

export function benchEnv(
	base: Readonly<Record<string, string | undefined>>,
	dir: string,
): Record<string, string | undefined> {
	return {
		...base,
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		PI_HARNESS_EVENTS: join(dir, "events"),
		NODE_OPTIONS: `${base["NODE_OPTIONS"] ?? ""} --cpu-prof --cpu-prof-dir=${dir}`.trim(),
	};
}
