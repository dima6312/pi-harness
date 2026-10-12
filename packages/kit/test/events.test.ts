import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	eventsDir,
	FolderFeed,
	LOGGED_EVENT,
	logEvent,
	logPath,
	type LogTarget,
	readFrom,
} from "../src/events/log.ts";

let root: string;
let dir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "events-"));
	dir = eventsDir("/home/me/repo", root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function target(session: string): LogTarget {
	return { dir, session };
}

test("a folder's logs live under one directory named like pi's session folders", () => {
	expect(dir).toBe(join(root, "--home-me-repo--"));
});

test("an event is appended to its session's log and published inside the process", () => {
	const published: unknown[] = [];
	const event = logEvent(
		target("s1"),
		{ emit: (_, data) => published.push(data) },
		"session.state",
		{
			state: "running",
		},
	);
	expect(published).toEqual([event]);
	const line = JSON.parse(readFileSync(logPath(target("s1")), "utf8"));
	expect(line).toMatchObject({
		v: 1,
		session: "s1",
		type: "session.state",
		data: { state: "running" },
	});
	expect(LOGGED_EVENT).toBe("harness:logged");
});

test("reading resumes where it stopped, and a line still being written waits", () => {
	logEvent(target("s1"), undefined, "session.state", { state: "running" });
	const first = readFrom(logPath(target("s1")), 0);
	expect(first.events).toHaveLength(1);
	appendFileSync(logPath(target("s1")), '{"v":1,"type":"session.state","sess');
	const partial = readFrom(logPath(target("s1")), first.offset);
	expect(partial).toEqual({ events: [], offset: first.offset });
	appendFileSync(
		logPath(target("s1")),
		'ion":"s1","at":5,"id":"x","data":{"state":"idle"}}\nnot json\n',
	);
	const rest = readFrom(logPath(target("s1")), partial.offset);
	expect(rest.events.map((event) => event.data)).toEqual([{ state: "idle" }]);
});

test("a feed reads every session in the folder, oldest first, each event once", () => {
	const feed = new FolderFeed(dir);
	expect(feed.read()).toEqual([]);
	logEvent(target("a"), undefined, "session.state", { state: "running" });
	logEvent(target("b"), undefined, "session.state", { state: "idle" });
	const events = feed.read();
	expect(events.map((event) => event.session)).toEqual(["a", "b"]);
	expect(feed.read()).toEqual([]);
	logEvent(target("a"), undefined, "session.ended", {});
	expect(feed.read().map((event) => event.type)).toEqual(["session.ended"]);
});
