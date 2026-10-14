// The prune's line in the chat, drawn by the package's own renderer between the tool call that
// ended the turn and the cache miss pi reports on the next request.
import type { Theme } from "@earendil-works/pi-coding-agent";

import { PruneEntry, priced } from "../../packages/compact/src/record.ts";
import { drawCalls } from "./calls.ts";
import { WIDTH } from "./drive.ts";

const HIDDEN = [
	{ entry: "a", call: "read src/view.ts", tokens: 4_200 },
	{ entry: "b", call: "bash bun test packages/tasks", tokens: 12_000 },
	{ entry: "c", call: "read packages/kit/src/tasks/apply.ts", tokens: 6_800 },
];

const BILLED = {
	input: 1_000,
	cacheRead: 500_000,
	cacheWrite: 10_000,
	cost: { input: 0.005, cacheRead: 0.25, cacheWrite: 0.0625 },
};

export function pruneLine(theme: Theme): string[] {
	const record = {
		before: 705_000,
		after: 250_000,
		hidden: Array.from({ length: 181 }, (_, index) => HIDDEN[index % HIDDEN.length]!),
		...priced(BILLED, 0, 455_000, 168_000),
	};
	return [
		...drawCalls(
			[
				{
					tool: "bash",
					args: { command: "gh pr list --state all -L 3" },
					output:
						"31 OPEN chore(main): release 5.7.0\n30 MERGED chore(deps): bump the pi SDK to 1.1.0",
					wroteMs: 700,
					ranMs: 1_000,
				},
			],
			WIDTH,
		),
		"",
		...new PruneEntry(record, false, theme).render(WIDTH),
		"",
		` ${theme.fg("warning", "Cache miss: 168k tokens re-billed ($0.947)")}`,
	];
}
