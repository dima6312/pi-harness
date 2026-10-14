#!/usr/bin/env bun
// Every PNG carries the hash of the SVG it was drawn from, so the check needs no renderer and
// `bun run docs` redraws only what changed.
/* oxlint-disable no-await-in-loop -- the scenes share pi's global theme, so they run in turn */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToHex } from "@earendil-works/pi-tui";
import { $ } from "bun";

import { markdownFiles, rewrite } from "./blocks.ts";
import { readKey, withKey } from "./png.ts";
import { SCENES, type Scene } from "./scenes.ts";
import { toSvg } from "./svg.ts";
import { darkTheme } from "./theme.ts";

const root = resolve(import.meta.dir, "../..");
const RAW = "https://raw.githubusercontent.com/felipeadeildo/pi-harness/main";

interface Picture {
	name: string;
	file: string;
	svg: string;
	key: string;
	block: string;
}

async function picture(scene: Scene, theme: Theme): Promise<Picture> {
	const [pkg, name] = scene.name.split("/");
	const file = `packages/${pkg}/assets/${name}.png`;
	const svg = toSvg(await scene.draw(theme), {
		background: "#18181e",
		foreground: colorToHex(theme.colors.text),
	});

	return {
		name: scene.name,
		file,
		svg,
		key: createHash("sha256").update(svg).digest("hex"),
		block: [
			`<p align="center">`,
			`  <img src="${RAW}/${file}" alt="${escape(scene.alt)}" width="860">`,
			`  <br>`,
			`  <em>${escape(scene.caption)}</em>`,
			`</p>`,
		].join("\n"),
	};
}

function escape(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function isStale(entry: Picture): boolean {
	const path = join(root, entry.file);
	return !existsSync(path) || readKey(readFileSync(path)) !== entry.key;
}

async function draw(entry: Picture): Promise<void> {
	const png = await $`rsvg-convert --zoom 2 - < ${new Response(entry.svg)}`.arrayBuffer();
	writeFileSync(join(root, entry.file), withKey(new Uint8Array(png), entry.key));
}

function syncPages(blocks: ReadonlyMap<string, string>, write: boolean): string[] {
	const changed: string[] = [];
	for (const file of markdownFiles(root)) {
		const source = readFileSync(file, "utf-8");
		if (!source.includes("<!-- docs:")) continue;
		const next = rewrite(source, file, blocks);
		if (next === source) continue;
		changed.push(file.slice(root.length + 1));
		if (write) writeFileSync(file, next);
	}
	return changed;
}

const theme = darkTheme();
const pictures: Picture[] = [];
for (const scene of SCENES) pictures.push(await picture(scene, theme));

const blocks = new Map(pictures.map((entry) => [entry.name, entry.block]));
const stale = pictures.filter(isStale);
const write = !process.argv.includes("--check");

if (write) for (const entry of stale) await draw(entry);
const changed = [...syncPages(blocks, write), ...stale.map((entry) => entry.file)];

if (!write && changed.length > 0) {
	console.error(`Out of date, run \`bun run docs\`:\n  ${changed.join("\n  ")}`);
	process.exit(1);
}
if (write)
	console.log(changed.length === 0 ? "Nothing to change." : `Updated ${changed.join(", ")}`);
else console.log("The pictures in the docs are up to date.");
