import { visibleWidth } from "@earendil-works/pi-tui";

/** Left and right on one line, the right flush with the edge. */
export function spread(left: string, right: string, width: number): string {
	return `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
}
