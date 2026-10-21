import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

import { expandHome } from "@adeildo/pi-kit";

import type { OutsideScope } from "#core/config/schema.ts";

export const OUTSIDE_SCOPES: readonly OutsideScope[] = ["ask", "allow", "deny"];

export const OUTSIDE_DESCRIPTION: Record<OutsideScope, string> = {
	ask: "a call outside the workspace asks you, in every mode",
	allow: "a call outside the workspace follows the mode",
	deny: "a call outside the workspace is blocked",
};

const PASTED_IMAGE_PREFIXES = ["pi-clipboard-", "pi-ask-permission-"];

// So `2>/dev/null` stays in the workspace.
const DEVICES = new Set([
	"/dev/null",
	"/dev/zero",
	"/dev/random",
	"/dev/urandom",
	"/dev/tty",
	"/dev/stdin",
	"/dev/stdout",
	"/dev/stderr",
]);

/** `unknown`: the paths hide behind `$VAR` or `$(...)`. `outside` holds every path that left,
 * canonical, and `path` is the first one as written. */
export type Reach =
	| { kind: "inside" }
	| { kind: "outside"; path: string; paths: string[] }
	| { kind: "unknown" };

/** The folders the dialog offers to open, shallow to deep. */
export interface FolderChoices {
	folders: string[];
	suggested: number;
	repoRoot: string | undefined;
}

/** Alt+W. It never lands on `deny`, which takes the command. */
export function toggleOutside(outside: OutsideScope): OutsideScope {
	return outside === "allow" ? "ask" : "allow";
}

// realpath, so a symlink out of the project does not count as inside.
export function reachOf(roots: string[], cwd: string, paths: string[] | undefined): Reach {
	if (paths === undefined) return { kind: "unknown" };

	const resolved = resolveRoots(roots, cwd);
	const temp = canonical(tmpdir());
	let first: string | undefined;
	const outside: string[] = [];
	for (const path of paths) {
		const lexical = normalize(resolvePath(path, cwd));
		// realpath turns /dev/stdout into the terminal's device.
		if (isDevice(lexical)) continue;

		const absolute = canonical(lexical);
		if (isPastedFile(absolute, temp)) continue;
		if (isInside(absolute, resolved)) continue;
		first ??= path;
		if (!outside.includes(absolute)) outside.push(absolute);
	}
	return first === undefined
		? { kind: "inside" }
		: { kind: "outside", path: first, paths: outside };
}

/** A folder that holds every path, up to the home but never the home itself, so opening it
 * stays narrow. The suggestion is the repository the paths live in, when there is one. */
export function folderChoices(paths: string[]): FolderChoices | undefined {
	const common = commonFolder(paths.map(folderOf));
	if (common === undefined) return undefined;

	const home = canonical(homedir());
	const folders: string[] = [];
	for (let folder = common; isOpenable(folder, home); folder = dirname(folder)) {
		folders.unshift(folder);
	}
	if (folders.length === 0) return undefined;

	const repoRoot = folders.findLast((folder) => existsSync(join(folder, ".git")));
	const suggested = repoRoot === undefined ? folders.length - 1 : folders.indexOf(repoRoot);
	return { folders, suggested, repoRoot };
}

export function isWithin(path: string, folder: string): boolean {
	return isInside(path, [folder]);
}

function folderOf(path: string): string {
	try {
		return statSync(path).isDirectory() ? path : dirname(path);
	} catch {
		return dirname(path);
	}
}

function commonFolder(folders: string[]): string | undefined {
	let common = folders[0];
	for (const folder of folders.slice(1)) {
		while (common !== undefined && !isInside(folder, [common])) {
			const parent = dirname(common);
			common = parent === common ? undefined : parent;
		}
	}
	return common;
}

// Never the root, the home, or a folder that holds the home.
function isOpenable(folder: string, home: string): boolean {
	if (folder === dirname(folder)) return false;
	return !isInside(home, [folder]);
}

export function resolveRoots(roots: string[], cwd: string): string[] {
	const list = roots.length > 0 ? roots : ["."];
	return list.map((root) => canonical(resolvePath(root, cwd)));
}

function resolvePath(path: string, cwd: string): string {
	return resolve(cwd, expandHome(path));
}

function canonical(path: string): string {
	const lexical = normalize(path);
	try {
		return realpathSync(lexical);
	} catch {
		try {
			return join(realpathSync(dirname(lexical)), basename(lexical));
		} catch {
			return lexical;
		}
	}
}

function isInside(path: string, roots: string[]): boolean {
	return roots.some((root) => {
		const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
		return path === root || path.startsWith(prefix);
	});
}

function isDevice(path: string): boolean {
	return DEVICES.has(path) || /^\/dev\/fd\/\d+$/.test(path) || /^\/proc\/self\/fd\/\d+$/.test(path);
}

function isPastedFile(path: string, temp: string): boolean {
	if (dirname(path) !== temp) return false;
	return PASTED_IMAGE_PREFIXES.some((prefix) => basename(path).startsWith(prefix));
}
