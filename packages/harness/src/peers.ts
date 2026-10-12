import { createApp } from "@adeildo/pi-kit";
import { peers } from "@adeildo/pi-peers";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessPeers(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(peers).build();
}
