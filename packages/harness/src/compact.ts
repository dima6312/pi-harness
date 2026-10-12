import { compact } from "@adeildo/pi-compact";
import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessCompact(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(compact).build();
}
