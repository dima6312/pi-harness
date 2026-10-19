#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
/**
 * Load the packed packages the way Pi will, from outside the repository.
 *
 * The tarballs are installed with npm into a directory outside the repository, so a dependency
 * that only resolves inside the workspace, or a source file the `files` list left out, fails here
 * instead of on a stranger's machine. Each package that ships an extension is then loaded with the
 * SDK's resource loader.
 *
 * Usage: bun scripts/smoke.ts [--keep]
 */
import { $ } from "bun";

import { workspacePackages } from "./packages.ts";
import { checkTarballs, packAll } from "./tarballs.ts";

const root = resolve(import.meta.dir, "..");
const keep = process.argv.includes("--keep");
const into = mkdtempSync(join(tmpdir(), "pi-harness-smoke-"));
const app = join(into, "app");
const agentDir = join(into, "agent");
mkdirSync(app, { recursive: true });
mkdirSync(agentDir, { recursive: true });
// Nothing here may read or write the machine's real pi directory.
process.env.PI_CODING_AGENT_DIR = agentDir;

const packages = workspacePackages(root);
const packed = await packAll(root, packages);

const problems = await checkTarballs(packed, packages);
if (problems.length > 0) {
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}

writeFileSync(
	join(app, "package.json"),
	`${JSON.stringify(
		{
			name: "pi-harness-smoke",
			private: true,
			dependencies: Object.fromEntries(
				packed.map((entry) => [entry.pkg.name, `file:${entry.tarball}`]),
			),
		},
		null,
		"\t",
	)}\n`,
);
console.log(`Installing ${packed.length} package(s) into ${app}\n`);
// Pi installs packages with --legacy-peer-deps, so the host packages are never on disk next to them:
// an import that only resolves through an installed peer has to fail here too.
const install =
	await $`npm install --no-audit --no-fund --ignore-scripts --legacy-peer-deps --loglevel error`
		.cwd(app)
		.nothrow();
if (install.exitCode !== 0) {
	console.error(install.stderr.toString());
	process.exit(1);
}

let failed = 0;
for (const entry of packed) {
	const dir = join(app, "node_modules", entry.pkg.name);
	if (entry.pkg.extensions.length === 0) {
		console.log(`ok ${entry.pkg.name}@${entry.pkg.version} (installed, no extension)`);
		continue;
	}

	const loader = new DefaultResourceLoader({
		cwd: app,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: [dir],
	});
	// oxlint-disable-next-line no-await-in-loop -- one package at a time, so a failure names it
	await loader.reload();

	const result = loader.getExtensions();
	const broken = result.errors.length > 0 || result.extensions.length < entry.pkg.extensions.length;
	if (broken) failed++;

	console.log(
		`${broken ? "x" : "ok"} ${entry.pkg.name}@${entry.pkg.version} (${result.extensions.length} extension(s))`,
	);
	for (const error of result.errors)
		console.error(`     ${error.path}: ${error.error.replaceAll("\n", "\n     ")}`);
}

if (!keep) rmSync(into, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
