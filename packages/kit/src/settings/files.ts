// Where the settings files live and how they are read and written. Every app shares them, so a
// write keeps every key it does not know.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

export type SettingsData = Record<string, unknown>;

export interface SettingsFile {
	data: SettingsData;
	warnings: string[];
}

export function globalSettingsPath(): string {
	return join(getAgentDir(), "extensions", "pi-harness", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "extensions", "pi-harness", "settings.json");
}

export function readSettingsFile(path: string): SettingsFile {
	try {
		const data: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isObject(data)) return { data, warnings: [] };
		return { data: {}, warnings: [`${path}: must contain a JSON object; using the defaults`] };
	} catch (error) {
		// A file that is not there is a fresh start, not a warning.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, warnings: [] };
		const reason = error instanceof Error ? error.message : String(error);
		return { data: {}, warnings: [`${path}: could not be read (${reason}); using the defaults`] };
	}
}

export function writeSettingsFile(
	path: string,
	data: SettingsData,
	options: { mode?: number } = {},
): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(data, null, "\t")}\n`, {
		encoding: "utf8",
		mode: options.mode,
	});
	renameSync(temporary, path);
}

export function lookup(data: SettingsData, id: string): unknown {
	let node: unknown = data;
	for (const key of id.split(".")) {
		if (!isObject(node)) return undefined;
		node = node[key];
	}
	return node;
}

/** Deletes the key, and every object it leaves empty. */
export function remove(data: SettingsData, id: string): void {
	const [key, ...rest] = id.split(".");
	if (key === undefined || !(key in data)) return;
	if (rest.length === 0) {
		delete data[key];
		return;
	}
	const child = data[key];
	if (!isObject(child)) return;
	remove(child, rest.join("."));
	if (Object.keys(child).length === 0) delete data[key];
}

export function assign(data: SettingsData, id: string, value: unknown): void {
	const keys = id.split(".");
	const last = keys.pop();
	if (last === undefined) return;

	let node = data;
	for (const key of keys) {
		const next = node[key];
		if (isObject(next)) {
			node = next;
			continue;
		}
		const created: SettingsData = {};
		node[key] = created;
		node = created;
	}
	node[last] = value;
}
