// Folders the user opened from the dialog. A call that reaches only open folders counts as inside
// the workspace, so the mode decides it. A read folder lets read-only calls in, a write folder
// lets everything in.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expandHome, tildify } from "@adeildo/pi-kit";

import { type Scope, SCOPES } from "#core/always-yes.ts";
import { isWithin } from "#core/workspace.ts";
import { describe, isRecord } from "#util/primitives.ts";

export type Access = "read" | "write";

export interface OpenFolder {
	path: string;
	access: Access;
}

export interface FolderFiles {
	global: string;
	/** Undefined when the project is not trusted. */
	project?: string;
}

export const FOLDERS_FILE = "folders.json";

type SavedScope = Exclude<Scope, "session">;
const SAVED_SCOPES: SavedScope[] = ["project", "global"];

export class OpenFolders {
	private readonly folders: Record<Scope, Map<string, Access>> = {
		session: new Map(),
		project: new Map(),
		global: new Map(),
	};
	private files: FolderFiles | undefined;

	open(files: FolderFiles): string[] {
		this.files = files;
		const warnings: string[] = [];
		for (const scope of SAVED_SCOPES) {
			const path = files[scope];
			if (path === undefined) {
				this.folders[scope] = new Map();
				continue;
			}
			const read = readFolders(path);
			this.folders[scope] = read.folders;
			if (read.warning) warnings.push(read.warning);
		}
		return warnings;
	}

	covers(path: string, access: Access): boolean {
		return SCOPES.some((scope) =>
			[...this.folders[scope]].some(
				([folder, granted]) => isWithin(path, folder) && allows(granted, access),
			),
		);
	}

	list(scope: Scope): OpenFolder[] {
		return [...this.folders[scope]].map(([path, access]) => ({ path, access }));
	}

	size(scope: Scope): number {
		return this.folders[scope].size;
	}

	total(): number {
		return SCOPES.reduce((sum, scope) => sum + this.size(scope), 0);
	}

	/** Returns why it was not saved. It still holds until pi exits. */
	add(scope: Scope, path: string, access: Access): string | undefined {
		widen(this.folders[scope], path, access);
		if (scope === "session") return undefined;

		const file = this.files?.[scope];
		if (file === undefined) return "this project is not trusted, so it was not saved";

		// Another pi may have saved since this one loaded, and a file that does not parse is
		// someone's hand edit, not something to overwrite.
		const read = readFolders(file);
		if (read.warning) return read.warning;

		widen(read.folders, path, access);
		this.folders[scope] = read.folders;
		return writeFolders(file, read.folders);
	}

	forget(scope: Scope): { removed: number; errors: string[] } {
		const removed = this.folders[scope].size;
		this.folders[scope].clear();
		const file = scope === "session" ? undefined : this.files?.[scope];
		if (file === undefined) return { removed, errors: [] };

		try {
			rmSync(file, { force: true });
			return { removed, errors: [] };
		} catch (error) {
			return { removed, errors: [describe(error)] };
		}
	}
}

function allows(granted: Access, wanted: Access): boolean {
	return granted === "write" || wanted === "read";
}

// A write folder already lets reads in, so a read never narrows it.
function widen(folders: Map<string, Access>, path: string, access: Access): void {
	if (folders.get(path) === "write") return;
	folders.set(path, access);
}

export function readFolders(path: string): { folders: Map<string, Access>; warning?: string } {
	if (!existsSync(path)) return { folders: new Map() };

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { folders: new Map(), warning: `could not parse ${path}: ${describe(error)}` };
	}
	if (!isRecord(raw)) return { folders: new Map(), warning: `${path} must contain a JSON object` };

	const folders = new Map<string, Access>();
	for (const access of ["read", "write"] as const) {
		const list = raw[access];
		if (!Array.isArray(list)) continue;
		for (const entry of list) {
			if (typeof entry === "string" && entry !== "") widen(folders, expandHome(entry), access);
		}
	}
	return { folders };
}

function writeFolders(path: string, folders: Map<string, Access>): string | undefined {
	const file: Record<Access, string[]> = { read: [], write: [] };
	for (const [folder, access] of folders) file[access].push(tildify(folder));
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			`${JSON.stringify({ read: file.read.toSorted(), write: file.write.toSorted() }, null, 2)}\n`,
			"utf8",
		);
		return undefined;
	} catch (error) {
		return describe(error);
	}
}
