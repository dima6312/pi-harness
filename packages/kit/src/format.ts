// How a number reads on the screen, the same in every package: a token count the footer, a panel and
// a cost table all show, and a price. The format was decided once, in the look, and moved here.

export function formatTokens(count: number): string {
	const n = Math.max(0, Math.round(count));
	if (n < 1000) return String(n);
	if (n < 10_000) return `${trim((n / 1000).toFixed(1))}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

/** A price: cents are worth showing under $10, and noise above it. */
export function formatCost(amount: number): string {
	if (amount === 0) return "$0.00";
	return amount < 10 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`;
}

function trim(fixed: string): string {
	return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** The time of day, hours and minutes, in the machine's own zone. */
export function formatClock(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
