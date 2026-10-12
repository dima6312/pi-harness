import { expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";

import {
	type AccountRow,
	type AccountsChoice,
	type AccountsListing,
	AccountsView,
} from "../src/ui/accounts.ts";

const THEME = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;
const TUI = { requestRender: () => {} } as unknown as TUI;

const ENTER = "\r";
const ESC = "\u001b";
const DOWN = "\u001b[B";

function listing(rows: AccountRow[]): AccountsListing & { rows(): AccountRow[] } {
	return {
		provider: "Anthropic",
		rows: () => rows,
		empty: "No Anthropic accounts yet.",
		rename: (id, label) => {
			const row = rows.find((candidate) => candidate.id === id);
			if (row !== undefined) row.label = label;
			return undefined;
		},
		remove: (id) => {
			rows.splice(
				rows.findIndex((row) => row.id === id),
				1,
			);
			return undefined;
		},
		removeQuestion: (row) => `Remove the Anthropic account "${row.label}"?`,
	};
}

function accounts(): AccountRow[] {
	return [
		{
			id: "a",
			label: "ranqia",
			kind: "subscription",
			inUse: true,
			state: {
				kind: "quota",
				windows: [
					{ name: "5h", used: 100, resetsIn: "46m" },
					{ name: "week", used: 18, resetsIn: "6d" },
				],
			},
		},
		{
			id: "b",
			label: "labora",
			kind: "subscription",
			inUse: false,
			state: { kind: "reading" },
		},
	];
}

function view(rows: AccountRow[]): { view: AccountsView; chosen: (AccountsChoice | undefined)[] } {
	const chosen: (AccountsChoice | undefined)[] = [];
	return {
		view: new AccountsView(TUI, THEME, listing(rows), (choice) => void chosen.push(choice)),
		chosen,
	};
}

function typing(target: AccountsView, text: string): void {
	for (const key of text) target.handleInput(key);
}

test("the list shows each account, the one in use, its plan, and a way to add one", () => {
	const width = 110;
	const lines = view(accounts()).view.render(width);
	const body = lines.join("\n");

	expect(lines[0]?.startsWith("╭─ Anthropic accounts ")).toBe(true);
	expect(body).toContain(
		"❯ ranqia  subscription  in use  5h   100% resets in 46m   week  18% resets in 6d",
	);
	expect(body).toContain("  labora  subscription          reading the plan...");
	expect(body).toContain("+ Add an account");
	expect(body).toContain("enter use");
	for (const line of lines) expect(visibleWidth(line)).toBe(width);
});

test("a narrow frame gives the kind's column to the plan", () => {
	const body = view(accounts()).view.render(60).join("\n");

	expect(body).not.toContain("subscription");
	expect(body).toContain("ranqia  in use  5h");
});

test("enter uses the account under the cursor, and the last row adds one", () => {
	const { view: list, chosen } = view(accounts());
	list.handleInput(DOWN);
	list.handleInput(ENTER);
	expect(chosen).toEqual([{ kind: "use", id: "b" }]);

	const again = view(accounts());
	again.view.handleInput(DOWN);
	again.view.handleInput(DOWN);
	again.view.handleInput(ENTER);
	expect(again.chosen).toEqual([{ kind: "add" }]);
});

test("an account that needs a sign-in signs in on enter", () => {
	const rows = accounts();
	const first = rows[0];
	if (first === undefined) throw new Error("no row");
	first.state = { kind: "signIn" };
	const { view: list, chosen } = view(rows);

	expect(list.render(100).join("\n")).toContain("enter sign in");
	list.handleInput(ENTER);
	expect(chosen).toEqual([{ kind: "signIn", id: "a" }]);
});

test("r renames in place, and the list says so", () => {
	const rows = accounts();
	const { view: list, chosen } = view(rows);

	list.handleInput("r");
	expect(list.render(100).join("\n")).toContain("enter save");
	for (let index = 0; index < "ranqia".length; index++) list.handleInput("\u007f");
	typing(list, "work");
	list.handleInput(ENTER);

	expect(rows[0]?.label).toBe("work");
	expect(chosen).toEqual([]);
	expect(list.render(100).join("\n")).toContain("Renamed to work");
});

test("an empty name keeps the field open, and escape keeps the old one", () => {
	const rows = accounts();
	const { view: list } = view(rows);

	list.handleInput("r");
	for (let index = 0; index < "ranqia".length; index++) list.handleInput("\u007f");
	list.handleInput(ENTER);
	expect(list.render(100).join("\n")).toContain("enter save");
	list.handleInput(ESC);

	expect(rows[0]?.label).toBe("ranqia");
	expect(list.render(100).join("\n")).toContain("enter use");
});

test("d asks before it removes, and the cursor stays where the row was", () => {
	const rows = accounts();
	const { view: list } = view(rows);

	list.handleInput("d");
	const asking = list.render(100).join("\n");
	expect(asking).toContain('Remove the Anthropic account "ranqia"?');
	expect(asking).toContain("enter remove");
	list.handleInput(ESC);
	expect(rows).toHaveLength(2);

	list.handleInput("d");
	list.handleInput(ENTER);
	const after = list.render(100).join("\n");
	expect(rows.map((row) => row.label)).toEqual(["labora"]);
	expect(after).toContain("Removed ranqia");
	expect(after).toContain("❯ labora");
});

test("an empty list says so and waits on the add row", () => {
	const { view: list, chosen } = view([]);
	const body = list.render(80).join("\n");

	expect(body).toContain("No Anthropic accounts yet.");
	expect(body).toContain("❯ + Add an account");
	list.handleInput(ENTER);
	expect(chosen).toEqual([{ kind: "add" }]);
});

test("escape closes without a choice, once", () => {
	const { view: list, chosen } = view(accounts());
	list.handleInput(ESC);
	list.handleInput(ENTER);
	expect(chosen).toEqual([undefined]);
});
