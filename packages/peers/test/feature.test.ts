import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, eventsDir, FolderFeed } from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";

import { committed, peers } from "../src/index.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "peers-feature-"));
	process.env.PI_HARNESS_EVENTS = join(dir, "events");
});

afterEach(() => {
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(dir, { recursive: true, force: true });
});

async function mounted(id: string) {
	writeFileSync(join(dir, "settings.json"), "{}");
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(peers)
		.build();
	const notes: string[] = [];
	let editor = "";
	const ctx = fakeContext([], true, {
		cwd: "/repo",
		sessionManager: { getBranch: () => [], getCwd: () => "/repo", getSessionId: () => id },
		ui: {
			notify: (message: string) => notes.push(message),
			setEditorText: (text: string) => (editor = text),
		},
		isIdle: () => true,
	});
	await fake.fire("session_start", {}, ctx);
	return { fake, ctx, notes, editor: () => editor };
}

test("no tool writes the folder's logs, so nothing can post words as yours", async () => {
	const { fake, ctx } = await mounted("a");
	const logs = eventsDir("/repo");
	const [write] = await fake.fire(
		"tool_call",
		{ toolName: "write", input: { path: join(logs, "x.jsonl") } },
		ctx,
	);
	expect(write).toMatchObject({ block: true });
	const [bash] = await fake.fire(
		"tool_call",
		{ toolName: "bash", input: { command: "echo '{}' >> ~/.pi/agent/harness/events/x.jsonl" } },
		ctx,
	);
	expect(bash).toMatchObject({ block: true });
	const [edit] = await fake.fire(
		"tool_call",
		{ toolName: "edit", input: { path: "src/auth.ts" } },
		ctx,
	);
	expect(edit).toBeUndefined();
});

test("what the agent edits, runs and commits goes on the board", async () => {
	const { fake, ctx } = await mounted("a");
	await fake.fire(
		"tool_execution_start",
		{ toolCallId: "1", toolName: "edit", args: { path: "/repo/src/auth.ts" } },
		ctx,
	);
	await fake.fire(
		"tool_execution_end",
		{ toolCallId: "1", toolName: "edit", isError: false, result: {} },
		ctx,
	);
	await fake.fire(
		"tool_execution_start",
		{ toolCallId: "2", toolName: "bash", args: { command: "git commit -m x" } },
		ctx,
	);
	await fake.fire(
		"tool_execution_end",
		{
			toolCallId: "2",
			toolName: "bash",
			isError: false,
			result: {
				content: [{ type: "text", text: "[main 3f2a91c] Fix the callback\n 1 file changed" }],
			},
		},
		ctx,
	);
	const activity = new FolderFeed(eventsDir("/repo"))
		.read()
		.filter((event) => event.type === "activity")
		.map((event) => event.data);
	expect(activity).toEqual([
		{ kind: "edited", path: "src/auth.ts" },
		{ kind: "ran", command: "git commit -m x", ok: true },
		{ kind: "committed", sha: "3f2a91c", subject: "Fix the callback" },
	]);
});

test("/to with a name nobody has puts your words back in the editor", async () => {
	const { fake, ctx, notes, editor } = await mounted("a");
	await fake.commands.get("to")?.handler("migrtion run the tests", ctx as never);
	expect(notes).toEqual(["No agent called migrtion in this folder."]);
	expect(editor()).toBe("/to migrtion run the tests");
});

test("the tool reads the board and refuses names nobody has", async () => {
	const { fake } = await mounted("a");
	const tool = fake.tools.find((candidate) => candidate.name === "peers");
	const board = await tool?.execute(
		"1",
		{ action: "board" },
		undefined,
		undefined,
		undefined as never,
	);
	expect(board?.content[0]).toMatchObject({ text: "No other agent is working in this folder." });
	const sent = await tool?.execute(
		"2",
		{ action: "send", to: "ghost", text: "hi" },
		undefined,
		undefined,
		undefined as never,
	);
	expect(sent?.content[0]).toMatchObject({
		text: "No other agent here is called ghost. Read the board for the names.",
	});
});

test("a commit line is read from git's output, with or without a root-commit note", () => {
	expect(committed("[main (root-commit) abc1234] First")).toEqual({
		sha: "abc1234",
		subject: "First",
	});
	expect(committed("nothing to commit")).toBeUndefined();
});
