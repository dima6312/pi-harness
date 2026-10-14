#!/usr/bin/env bun
// The steps of `.github/workflows/newest-pi.yml`. `compare` says whether to test the newest pi, and
// `report` opens a bump PR when verify passed, or an issue when it failed.
import { readFileSync } from "node:fs";

import { $ } from "bun";

import {
	closeIssues,
	details,
	fileIssue,
	filesChanged,
	logTail,
	openIssues,
	openPullRequest,
	setOutputs,
} from "./github.ts";

const PACKAGES = ["pi-ai", "pi-coding-agent", "pi-tui"];
const TRACKED = "pi-coding-agent";
const LABEL = "newest-pi";
const BRANCH = "newest-pi";
const PI = "https://github.com/earendil-works/pi";

const manifest = JSON.parse(readFileSync("package.json", "utf-8")) as {
	devDependencies: Record<string, string>;
};

function pinned(name: string): string {
	return (manifest.devDependencies[`@earendil-works/${name}`] ?? "").replace(/^[\^~]/, "");
}

async function newest(name: string): Promise<string> {
	const response = await fetch(`https://registry.npmjs.org/@earendil-works/${name}/latest`);
	return ((await response.json()) as { version: string }).version;
}

// A run tests when a pin moved, when someone asked for a check by hand, or when an issue is still
// open so the day it turns green closes it.
async function compare(): Promise<void> {
	const versions = await Promise.all(PACKAGES.map(newest));
	const tracked = PACKAGES.indexOf(TRACKED);
	const moved = PACKAGES.some((name, index) => pinned(name) !== versions[index]);
	const event = process.env.GITHUB_EVENT_NAME;
	const open = (await openIssues(LABEL)).length > 0;
	setOutputs({
		test: String(moved || event === "workflow_dispatch" || (event === "schedule" && open)),
		pinned: pinned(TRACKED),
		newest: versions[tracked] ?? "",
	});
}

async function releaseNotes(version: string): Promise<string> {
	const result = await $`gh api repos/earendil-works/pi/releases/tags/v${version} --jq .body`
		.quiet()
		.nothrow();
	return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

/** The release notes as a collapsible block, read only when a body is about to carry it. */
async function piChanges(version: string): Promise<string[]> {
	const notes = await releaseNotes(version);
	return notes ? details(`What pi ${version} changed`, notes) : [];
}

async function report(): Promise<void> {
	const passed = process.env.VERIFY === "success";
	const version = process.env.NEWEST ?? "";
	const pinnedVersion = process.env.PINNED ?? "";
	const run = process.env.RUN_URL ?? "";
	const range =
		pinnedVersion === version
			? `pinned here: \`${version}\` already, so this only re-ran the check`
			: `\`${pinnedVersion}\` → \`${version}\` ([compare](${PI}/compare/v${pinnedVersion}...v${version}))`;
	const links = [
		`- ${range}`,
		`- [run](${run})`,
		`- [release notes](${PI}/releases/tag/v${version})`,
	];

	if (!passed) {
		const lead =
			pinnedVersion === version
				? `\`bun run verify\` failed twice in a row against \`${version}\`, the version already pinned here. The pin did not move, so this is the check running red on its own, not a release that arrived. The two runs are in the history of this issue.`
				: `The newest \`@earendil-works/pi-coding-agent\` is \`${version}\`, and \`bun run verify\` fails against it. A type or test failure is an API change. A \`pi:defaults\` failure is a default the harness's settings were chosen against.`;
		await fileIssue(
			{
				label: LABEL,
				description: "Fails against the latest pi SDK",
				color: "f9d0c4",
				title: `pi SDK ${version} fails the suite`,
				trailingNewline: false,
				skipWhenMentions: `\`${version}\``,
			},
			[lead, "", ...links, "", ...logTail(), "", ...(await piChanges(version))],
		);
		return;
	}

	const bumped = await filesChanged(["package.json"]);
	if (bumped) {
		await openPullRequest(
			{
				branch: BRANCH,
				title: `chore(deps): bump the pi SDK to ${version}`,
				files: ["package.json", "bun.lock"],
				trailingNewline: false,
				pushArgs: ["--force"],
			},
			[
				`pi released \`${version}\`, and the whole suite passes against it, the API and the defaults included.`,
				"",
				...links,
				"",
				...(await piChanges(version)),
				"",
				"The `CI` run on this PR waits in `action_required` until a maintainer approves it, which is how GitHub treats a pull request opened by `github-actions[bot]`.",
			],
		);
	}
	await closeIssues(LABEL, `\`${version}\` runs green again: ${run}`);
}

const command = process.argv[2];
if (command === "compare") await compare();
else if (command === "report") await report();
else throw new Error("usage: bun scripts/newest-pi.ts compare|report");
