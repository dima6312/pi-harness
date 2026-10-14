// Each app answers the screen for the features it runs. A change goes through the setting's own
// decoder, like a value read from the file.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	APPLY,
	type ApplyRequest,
	DONE,
	LIST,
	type RowView,
	RUN,
	type RunDone,
	type RunRequest,
	type TabView,
} from "../contracts/screen.ts";
import type { Json } from "../control.ts";
import { formatProblems, isObject } from "../decode.ts";
import { controlOf, type Setting } from "../settings/setting.ts";
import type { SettingsStore } from "../settings/store.ts";
import type { Feature, ScreenEntry, ScreenGroup } from "./feature.ts";

export interface Host {
	pi: ExtensionAPI;
	settings: SettingsStore;
	features: () => readonly Feature[];
	screen: ReadonlyMap<string, ScreenEntry[]>;
	/** Rows a feature builds when the screen opens. */
	screenGroups: ReadonlyMap<string, ScreenGroup[]>;
	session: () => ExtensionContext | undefined;
	isLive: () => boolean;
}

export function serveScreen(host: Host): void {
	host.pi.events.on(LIST, (data) => {
		if (!host.isLive() || !isObject(data) || !Array.isArray(data.tabs)) return;
		const ctx = host.session();
		for (const feature of host.features()) data.tabs.push(tabOf(host, feature, ctx));
	});

	host.pi.events.on(APPLY, (data) => {
		const request = asApply(data);
		if (request === undefined || !host.isLive()) return;
		const feature = host.features().find((entry) => entry.id === request.feature);
		if (feature === undefined) return;
		request.answer = { error: apply(host, feature, request) };
	});

	host.pi.events.on(RUN, (data) => {
		const request = asRun(data);
		if (request === undefined || !host.isLive()) return;
		if (!host.features().some((entry) => entry.id === request.feature)) return;
		const ctx = host.session();
		const row = findRow(host, request.feature, request.id, ctx);
		if (row === undefined) return;

		if (row.kind !== "action" || ctx === undefined) {
			request.answer = { error: "nothing to run" };
			return;
		}
		request.answer = {};
		const id = request.request;
		void runAction(row, ctx).then((done) => host.pi.events.emit(DONE, { request: id, ...done }));
	});
}

function tabOf(host: Host, feature: Feature, ctx: ExtensionContext | undefined): TabView {
	const rows: RowView[] = [];
	for (const entry of feature.settings ?? []) {
		const row = settingRow(host.settings, feature, entry, ctx);
		if (row !== undefined) rows.push(row);
	}
	if (ctx !== undefined) {
		for (const entry of entriesOf(host, feature.id, ctx)) rows.push(screenRow(feature, entry, ctx));
	}

	const listed = typeof feature.sections === "function" ? feature.sections(ctx) : feature.sections;
	const sections = [...(listed ?? [])];
	for (const row of rows) if (!sections.includes(row.section)) sections.push(row.section);
	return { title: feature.tab ?? capitalize(feature.id), sections, rows };
}

function settingRow(
	settings: SettingsStore,
	feature: Feature,
	entry: Setting<unknown>,
	ctx: ExtensionContext | undefined,
): RowView | undefined {
	const ui = entry.ui;
	if (ui === undefined) return undefined;

	const control = controlOf(entry, ctx);
	const value = toJson(settings.get(entry));
	const layer = settings.layer(entry);
	const row: RowView = {
		feature: feature.id,
		id: entry.id,
		kind: control === undefined ? "info" : "setting",
		section: ui.section,
		label: ui.label,
		description: ui.description,
		value,
		layer,
		fallback: toJson(entry.default),
	};
	if (control === undefined) row.text = JSON.stringify(value);
	else row.control = control;
	if (layer === "project") row.hidden = toJson(settings.hidden(entry));
	if (ui.restart === true) row.restart = true;
	if (ui.preview !== undefined) row.preview = ui.preview;
	return row;
}

function screenRow(feature: Feature, entry: ScreenEntry, ctx: ExtensionContext): RowView {
	const row: RowView = {
		feature: feature.id,
		id: entry.id,
		kind: entry.kind,
		section: entry.section,
		label: entry.label,
		description: entry.description,
	};
	if (entry.indent !== undefined) row.indent = entry.indent;
	switch (entry.kind) {
		case "value":
			row.control = typeof entry.control === "function" ? entry.control(ctx) : entry.control;
			row.value = entry.get(ctx);
			if (entry.meta !== undefined) row.meta = entry.meta;
			const shown = entry.text?.(ctx);
			if (shown !== undefined) row.text = shown;
			break;
		case "action": {
			const text = entry.text?.(ctx);
			if (text !== undefined) row.text = text;
			if (entry.confirm !== undefined) row.confirm = entry.confirm;
			break;
		}
		case "info":
			row.text = entry.text(ctx);
			break;
	}
	return row;
}

function apply(host: Host, feature: Feature, request: ApplyRequest): string | undefined {
	const entry = feature.settings?.find((candidate) => candidate.id === request.id);
	if (entry !== undefined) {
		if (request.op === "unset") {
			const layer = host.settings.layer(entry);
			return layer === "default" ? undefined : host.settings.unset(entry, layer);
		}
		const decoded = entry.decoder.decode(request.value, entry.id);
		if (!decoded.ok) return formatProblems(decoded.problems).join("; ");
		return host.settings.set(entry, decoded.value);
	}

	const ctx = host.session();
	const row = findRow(host, feature.id, request.id, ctx);
	if (row?.kind !== "value" || ctx === undefined) return "this row cannot change";
	if (request.op === "unset") return "this row has no default to go back to";
	return row.set(request.value ?? null, ctx);
}

/** The rows a feature has at this moment: the ones it declared, then the ones it builds. */
function entriesOf(host: Host, feature: string, ctx: ExtensionContext): ScreenEntry[] {
	return [
		...(host.screen.get(feature) ?? []),
		...(host.screenGroups.get(feature) ?? []).flatMap((group) => group(ctx)),
	];
}

/** An action can sit on a built row too, so the lookup walks the same two places. */
function findRow(
	host: Host,
	feature: string,
	id: string,
	ctx: ExtensionContext | undefined,
): ScreenEntry | undefined {
	if (ctx === undefined) return host.screen.get(feature)?.find((candidate) => candidate.id === id);
	return entriesOf(host, feature, ctx).find((candidate) => candidate.id === id);
}

async function runAction(
	row: Extract<ScreenEntry, { kind: "action" }>,
	ctx: ExtensionContext,
): Promise<Omit<RunDone, "request">> {
	try {
		const text = await row.run(ctx);
		return text === undefined ? {} : { text };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function asApply(data: unknown): ApplyRequest | undefined {
	if (!isObject(data) || data.answer !== undefined) return undefined;
	const { feature, id, op } = data;
	if (typeof feature !== "string" || typeof id !== "string") return undefined;
	if (op !== "set" && op !== "unset") return undefined;
	return data as unknown as ApplyRequest;
}

function asRun(data: unknown): RunRequest | undefined {
	if (!isObject(data) || data.answer !== undefined) return undefined;
	const { feature, id, request } = data;
	if (typeof feature !== "string" || typeof id !== "string" || typeof request !== "string")
		return undefined;
	return data as unknown as RunRequest;
}

function toJson(value: unknown): Json {
	return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
