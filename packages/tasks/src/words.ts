import type { LineKind } from "./transcript.ts";

export const ASKING =
	/(?<!\p{L})(vamos|vou|pode|podemos|bora|faz|faça|let's|let me|please|can you|could you)(?!\p{L})/iu;
const PLAN_START = /^(i'll|i will|i'm going to|let me|let's|vou|vamos|deixa eu|deixe-me)\b/i;
const PLAN_AFTER =
	/^(now|next|then|first|agora|em seguida|depois|primeiro)\b[^.]{0,40}\b(i'll|i will|let me|vou)\b/i;

/** A line that reports and then says what comes next ("Pushed. Now I watch the build:") still reports. */
export function isPlan(said: string, next?: LineKind): boolean {
	const sentences = said
		.trim()
		.replace(/[`*_]+$/g, "")
		.split(/(?<=[.!])\s+/);
	return sentences.every((sentence, index) =>
		plans(sentence, index === sentences.length - 1 ? next : "said"),
	);
}

function plans(sentence: string, next: LineKind | undefined): boolean {
	if (PLAN_START.test(sentence) || PLAN_AFTER.test(sentence) || sentence.endsWith("?")) return true;
	// "Now the router:" leads into a call; a report that ends in a colon leads into its list.
	return sentence.endsWith(":") && (next === undefined || next === "call");
}

/** Two words with the same first letters are one: "publiquei" names "Publicar". */
const STEM = 5;
const COMMON_PT = "agora aqui esse essa isso esta está para pode feito fazer tudo";
const COMMON_EN = "with that this done already just have";
const COMMON = new Set(`${COMMON_PT} ${COMMON_EN}`.split(" "));

function stems(words: string): Set<string> {
	return new Set(
		normalized(words)
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word.length >= 4 && !COMMON.has(word))
			.map((word) => word.slice(0, STEM)),
	);
}

export function sharesWord(left: string, right: string): boolean {
	const named = stems(right);
	return [...stems(left)].some((stem) => named.has(stem));
}

export function sameWords(left: string, right: string): boolean {
	const a = stems(left);
	const b = stems(right);
	const shared = sharedCount(a, b);
	return shared > 0 && shared / Math.max(a.size, b.size) >= 0.75;
}

export function echoes(part: string, whole: string): boolean {
	const words = stems(part);
	return words.size > 0 && sharedCount(words, stems(whole)) / words.size >= 0.75;
}

function sharedCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	return [...left].filter((stem) => right.has(stem)).length;
}

export function normalized(value: string): string {
	return value
		.toLowerCase()
		.replace(/[*_`"'“”‘’]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
