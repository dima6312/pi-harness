import { expect, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { drawSkillRefs, referencedSkills, SKILLS, skillNames } from "../src/contracts/skills.ts";

const NAMES = ["simplify", "unslop", "ce-simplify-code"];

test("a reference counts anywhere in the text, once per skill, in order", () => {
	const text = "use /skill:unslop, then (/skill:simplify) and /skill:unslop again";
	expect(referencedSkills(text, NAMES)).toEqual(["unslop", "simplify"]);
});

test("a reference needs a known name, a boundary before it and the whole name", () => {
	expect(referencedSkills("/skill:nope and x/skill:simplify", NAMES)).toEqual([]);
	expect(referencedSkills("/skill:simplify-more", NAMES)).toEqual([]);
	expect(referencedSkills("/skill:ce-simplify-code", NAMES)).toEqual(["ce-simplify-code"]);
});

test("in backticks a reference stays text", () => {
	expect(referencedSkills("type `/skill:simplify` to call it", NAMES)).toEqual([]);
});

test("each reference is drawn in place, and the rest of the text stays", () => {
	const drawn = drawSkillRefs(
		"use /skill:simplify, then /skill:unslop",
		NAMES,
		(name) => `[${name}]`,
	);
	expect(drawn).toBe("use [simplify], then [unslop]");
});

test("the names come from the skills feature, and none without it", () => {
	const scope = { events: createEventBus(), warn: () => {} };
	expect(skillNames(scope)).toEqual([]);
	SKILLS.provide(scope, () => NAMES);
	expect(skillNames(scope)).toEqual(NAMES);
});

test("a reference anywhere inside backticks stays text", () => {
	expect(referencedSkills("type `use /skill:simplify` and /skill:unslop", NAMES)).toEqual([
		"unslop",
	]);
	expect(drawSkillRefs("`a /skill:simplify` /skill:unslop", NAMES, (name) => `[${name}]`)).toBe(
		"`a /skill:simplify` [unslop]",
	);
});
