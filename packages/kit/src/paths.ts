// The home folder as `~`, both ways: what you type expands, and what is shown shortens.
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** `~` and `~/x` as paths under the home folder; anything else unchanged. */
export function expandHome(path: string, home = homedir()): string {
	if (path === "~") return home;
	return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** An absolute path under the home folder written from `~`; any other path unchanged. */
export function tildify(path: string, home = homedir()): string {
	if (home === "" || !isAbsolute(path)) return path;
	const rest = relative(resolve(home), resolve(path));
	if (rest === "") return "~";
	if (rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) return path;
	return `~${sep}${rest}`;
}
