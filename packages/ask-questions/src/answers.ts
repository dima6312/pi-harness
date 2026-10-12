import { type AskQuestion, type AskResult, describeAnswers, isAnswered } from "@adeildo/pi-kit";

const NOT_SEEN =
	"The user never saw the questions, so this is not a decline. Ask them in the chat instead.";

export function answerText(result: AskResult, questions: readonly AskQuestion[]): string {
	if (result.error !== undefined) return `${result.error}. ${NOT_SEEN}`;

	const answered = result.answers.filter(isAnswered);
	if (result.cancelled) {
		const lines = ["The user closed the questions without submitting. Do not assume an answer."];
		if (answered.length > 0)
			lines.push("Before closing they had answered:", ...describeAnswers(answered));
		return lines.join("\n");
	}
	if (answered.length === 0) return "The user submitted without answering any question.";

	const lines = ["The user answered:", ...describeAnswers(answered)];
	const skipped = questions.filter(
		(question) => !answered.some((answer) => answer.question === question.question),
	);
	if (skipped.length > 0)
		lines.push(
			`Left unanswered: ${skipped.map((question) => `"${question.question}"`).join(", ")}`,
		);
	lines.push("Continue with these answers in mind.");
	return lines.join("\n");
}
