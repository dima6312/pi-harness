// Every frame comes from the clock, so a picture drawn at a given time always looks the same.

export const FRAME_MS = 100;
export const FRESH_MS = 4_000;

const SPINNER = [
	"\u280b",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283c",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280f",
] as const;

export function spin(now: number): string {
	return SPINNER[Math.floor(now / FRAME_MS) % SPINNER.length] ?? SPINNER[0];
}

export function dots(now: number): string {
	return [".  ", ".. ", "..."][Math.floor(now / 400) % 3] ?? "...";
}

export function blink(now: number): boolean {
	return Math.floor(now / 500) % 2 === 0;
}

export function isFresh(at: number, now: number): boolean {
	return now - at >= 0 && now - at < FRESH_MS;
}
