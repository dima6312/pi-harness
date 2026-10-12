import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface Piece {
	text: string;
	compact?: string | undefined;
	priority: number;
	/** How the piece fits in less room than its compact form, when it is alone on the line. */
	shrink?: (width: number) => string;
}

export interface FitOptions {
	separator: string;
	regionOverhead?: number;
	ellipsis?: string;
}

interface Slot {
	region: number;
	order: number;
	piece: Piece;
	text: string;
	dropped: boolean;
}

export function fitRegions(
	regions: readonly (readonly Piece[])[],
	width: number,
	options: FitOptions,
): string[] {
	const slots: Slot[] = regions.flatMap((pieces, region) =>
		pieces.map((piece, order) => ({ region, order, piece, text: piece.text, dropped: false })),
	);
	const byPriority = slots.toSorted((a, b) => a.piece.priority - b.piece.priority);
	const measure = (): number => measureRegions(regions.length, slots, options);

	for (const slot of byPriority) {
		if (measure() <= width) break;
		if (slot.piece.compact !== undefined) slot.text = slot.piece.compact;
	}

	for (const slot of byPriority) {
		if (measure() <= width) break;
		if (slots.filter((candidate) => !candidate.dropped).length <= 1) break;
		slot.dropped = true;
	}

	const joined = join(regions.length, slots, options.separator);
	if (measure() <= width) return joined;

	const kept = slots.filter((slot) => !slot.dropped);
	const alone = regions.length === 1 ? kept[0]?.piece.shrink : undefined;
	if (kept.length === 1 && alone !== undefined) return [alone(width)];

	const overhead = options.regionOverhead ?? 0;
	return joined.map((text) =>
		text === ""
			? ""
			: truncateToWidth(text, Math.max(0, width - overhead), options.ellipsis ?? "..."),
	);
}

export function fitLine(pieces: readonly Piece[], width: number, options: FitOptions): string {
	return fitRegions([pieces], width, options)[0] ?? "";
}

function join(count: number, slots: readonly Slot[], separator: string): string[] {
	const regions: string[][] = Array.from({ length: count }, () => []);
	for (const slot of slots.toSorted((a, b) => a.order - b.order)) {
		if (!slot.dropped) regions[slot.region]?.push(slot.text);
	}
	return regions.map((texts) => texts.join(separator));
}

function measureRegions(count: number, slots: readonly Slot[], options: FitOptions): number {
	const separatorWidth = visibleWidth(options.separator);
	let total = 0;
	for (let region = 0; region < count; region++) {
		const kept = slots.filter((slot) => slot.region === region && !slot.dropped);
		if (kept.length === 0) continue;
		total += options.regionOverhead ?? 0;
		total += kept.reduce((sum, slot) => sum + visibleWidth(slot.text), 0);
		total += separatorWidth * (kept.length - 1);
	}
	return total;
}
