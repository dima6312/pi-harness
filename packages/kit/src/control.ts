// How the settings screen edits a value. Plain JSON, because the screen may live in another package.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ControlOption {
	value: Json;
	label?: string;
	description?: string;
}

export type Control =
	| { type: "toggle" }
	| { type: "choice"; options: ControlOption[]; custom?: boolean }
	| { type: "number"; min?: number; max?: number; step?: number; unit?: string; nullable?: boolean }
	| { type: "text"; multiline?: boolean; presets?: ControlOption[] }
	| { type: "list"; options?: ControlOption[] };

export function formatValue(control: Control, value: Json | undefined): string {
	if (value === undefined || value === null) return control.type === "number" ? "none" : "";
	switch (control.type) {
		case "toggle":
			return value === true ? "on" : "off";
		case "choice":
			return optionLabel(control.options, value);
		case "number":
			return control.unit === undefined ? String(value) : `${value}${control.unit}`;
		case "text":
			if (typeof value !== "string") return JSON.stringify(value);
			if (control.presets !== undefined) {
				const preset = control.presets.find((option) => option.value === value);
				if (preset !== undefined) return preset.label ?? String(preset.value);
				if (value.trim() === "") return "(empty)";
				return "custom";
			}
			return firstLine(value);
		case "list":
			if (!Array.isArray(value)) return JSON.stringify(value);
			if (value.length === 0) return "(none)";
			return value.map((entry) => optionLabel(control.options ?? [], entry)).join(", ");
	}
}

export function optionLabel(options: readonly ControlOption[], value: Json): string {
	const option = options.find((entry) => sameJson(entry.value, value));
	return optionText(option ?? { value });
}

export function optionText(option: ControlOption): string {
	if (option.label !== undefined) return option.label;
	return typeof option.value === "string" ? option.value : JSON.stringify(option.value);
}

export function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return text.includes("\n") ? `${line} ...` : line;
}
