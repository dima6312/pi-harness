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
/** Wide enough to read at GitHub's column, and half that for two pictures in one row. */
const PICTURE_WIDTH = 860;
const ROW_WIDTH = 420;

interface Picture {
	name: string;
	file: string;
	svg: string;
	key: string;
	caption: string;
	alt: string;
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
		caption: scene.caption,
		alt: scene.alt,
	};
}

function imageTag(shot: Picture, width: number): string {
	return `  <img src="${RAW}/${shot.file}" alt="${escape(shot.alt)}" width="${width}">`;
}

/** One picture, and the line under it. */
function pictureBlock(shot: Picture): string {
	return [
		`<p align="center">`,
		imageTag(shot, PICTURE_WIDTH),
		`  <br>`,
		`  <em>${escape(shot.caption)}</em>`,
		`</p>`,
	].join("\n");
}

/** Two pictures in one row, each half as wide, under the line the first one carries. */
function rowBlock(left: Picture, right: Picture): string {
	return [
		`<p align="center">`,
		imageTag(left, ROW_WIDTH),
		imageTag(right, ROW_WIDTH),
		`  <br>`,
		`  <em>${escape(left.caption)}</em>`,
		`</p>`,
	].join("\n");
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

// A scene with `beside` puts both pictures in one row, so only the first of the two gets a block.
const byName = new Map(pictures.map((entry) => [entry.name, entry]));
const blocks = new Map<string, string>();
for (const scene of SCENES) {
	const mine = byName.get(scene.name);
	if (mine === undefined) continue;
	if (scene.beside === undefined) {
		blocks.set(scene.name, pictureBlock(mine));
		continue;
	}
	const partner = byName.get(scene.beside);
	if (partner === undefined)
		throw new Error(`no scene called "${scene.beside}" to sit beside ${scene.name}`);
	blocks.set(scene.name, rowBlock(mine, partner));
}
const stale = pictures.filter(isStale);
const write = !process.argv.includes("--check");

if (write) await Promise.all(stale.map((entry) => draw(entry)));
const changed = [...syncPages(blocks, write), ...stale.map((entry) => entry.file)];

if (!write && changed.length > 0) {
	console.error(`Out of date, run \`bun run docs\`:\n  ${changed.join("\n  ")}`);
	process.exit(1);
}
if (write)
	console.log(changed.length === 0 ? "Nothing to change." : `Updated ${changed.join(", ")}`);
else console.log("The pictures in the docs are up to date.");
