import { createApp } from "@adeildo/pi-kit";
import { accounts, cache, compatible, subscription } from "@adeildo/pi-providers";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessProviders(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" })
		.use(subscription)
		.use(accounts)
		.use(cache)
		.use(compatible)
		.build();
}
