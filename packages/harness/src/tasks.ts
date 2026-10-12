import { createApp } from "@adeildo/pi-kit";
import { tasks } from "@adeildo/pi-tasks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessTasks(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(tasks).build();
}
