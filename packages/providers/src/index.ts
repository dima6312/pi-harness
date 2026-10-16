import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { accounts } from "./accounts/feature.ts";
import { NAME } from "./accounts/names.ts";
import { cache } from "./cache/feature.ts";
import { compatible } from "./compatible/feature.ts";
import { subscription } from "./subscription/feature.ts";

export { accounts } from "./accounts/feature.ts";
export { onAuthFailure, onLimit, WHEN_LIMITED, type WhenLimited } from "./accounts/settings.ts";
export { accountsPath, AccountStore } from "./accounts/store.ts";
export { cache } from "./cache/feature.ts";
export { compatible } from "./compatible/feature.ts";
export { betas, subscription } from "./subscription/feature.ts";

export default function piProviders(pi: ExtensionAPI): void {
	createApp(pi, { name: NAME }).use(subscription).use(accounts).use(cache).use(compatible).build();
}
