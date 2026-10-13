// A framed screen for a provider login: what it is doing, the URL or the code to use, and the answer
// it waits for. The provider drives it through the interaction pi would hand it.
import { spawn } from "node:child_process";

import { frame, frameInner, type KeyHint } from "@adeildo/pi-kit";
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import {
	copyToClipboard,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	hyperlink,
	Input,
	Key,
	matchesKey,
	Text,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";

const MAX_LOG = 5;

/** Pi's own Text wraps the URL and the instructions into the rows the frame draws. */
function wrap(text: string, width: number): string[] {
	return new Text(text, 0, 0).render(width);
}

/** The opener pi uses, so the sign-in page opens on its own and the URL stays for the rest. */
function openBrowser(target: string): void {
	const opener: [string, string[]] =
		process.platform === "darwin"
			? ["open", [target]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", target]]
				: ["xdg-open", [target]];
	spawn(...opener, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}

export interface LoginSession {
	interaction: ProviderAuthInteraction;
	/** Ends the screen once the login finished one way or another. */
	close(): void;
}

/** Opens the framed login, or undefined when this host cannot draw it. */
export function loginScreen(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
): Promise<LoginSession | undefined> {
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return Promise.resolve(undefined);
	return new Promise((resolve) => {
		void ctx.ui.custom<undefined>((tui, theme, keybindings, done) => {
			const view = new LoginView(tui, theme, label, signal, () => done(undefined), {
				keybindings,
			});
			resolve({ interaction: view.interaction(), close: () => view.finish() });
			return view;
		});
	});
}

interface Pending {
	prompt: AuthPrompt;
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

/** What the screen does outside itself: open the sign-in page and copy the URL out. */
export interface LoginActions {
	keybindings?: KeybindingsManager;
	open?: (url: string) => void;
	copy?: (text: string) => Promise<void>;
}

export class LoginView implements Component, Focusable {
	focused = true;
	private readonly input = new Input();
	private readonly log: string[] = [];
	private link: { url: string; instructions?: string } | undefined;
	private code: string | undefined;
	private copyNote: string | undefined;
	private pending: Pending | undefined;
	private selected = 0;
	private closed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly label: string,
		private readonly signal: AbortSignal,
		private readonly closeView: () => void,
		private readonly actions: LoginActions = {},
	) {
		this.input.onSubmit = (value) => {
			// An empty answer would cancel the callback and fail the exchange.
			if (value !== "") this.settle(value);
		};
		this.input.onEscape = () => this.cancel();
		signal.addEventListener("abort", () => this.finish(), { once: true });
	}

	interaction(): ProviderAuthInteraction {
		return {
			signal: this.signal,
			prompt: async (prompt) => await this.ask(prompt),
			notify: (event) => this.show(event),
		};
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const pending = this.pending;
		if (pending === undefined) return;
		if (pending.prompt.type === "select") {
			this.move(data, pending.prompt.options.length);
			return;
		}
		if (this.link !== undefined && this.copyLink(data)) return;
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const inner = frameInner(width);
		const rows = this.log.slice(-MAX_LOG).map((line) => this.theme.fg("muted", `· ${line}`));
		if (this.link !== undefined) {
			if (this.link.instructions !== undefined)
				rows.push(...wrap(this.theme.fg("warning", this.link.instructions), inner));
			rows.push(...wrap(this.theme.fg("accent", hyperlink(this.link.url, this.link.url)), inner));
			rows.push(this.linkHint());
		}
		if (this.code !== undefined) rows.push(this.theme.bold(this.code));
		rows.push("", ...this.promptRows(inner));
		return frame(this.theme, width, rows, {
			title: `Entrar · ${this.label}`,
			keys: this.hint(),
		});
	}

	/** Ends the screen; the login it was drawing ended one way or another. */
	finish(): void {
		if (this.closed) return;
		this.closed = true;
		this.cancel();
		this.closeView();
	}

	private ask(prompt: AuthPrompt): Promise<string> {
		return new Promise((resolve, reject) => {
			this.pending = { prompt, resolve, reject };
			this.selected = 0;
			this.input.setValue("");
			this.tui.requestRender();
		});
	}

	private show(event: AuthEvent): void {
		if (event.type === "auth_url") {
			this.link = { url: event.url, instructions: event.instructions };
			this.copyNote = undefined;
			(this.actions.open ?? openBrowser)(event.url);
		} else if (event.type === "device_code") {
			this.code = event.userCode;
			this.link = { url: event.verificationUri };
			this.copyNote = undefined;
		} else {
			this.log.push(event.message);
		}
		this.tui.requestRender();
	}

	/** The copy key on a shown URL, which is what a session without a browser needs. */
	private copyLink(data: string): boolean {
		const link = this.link;
		if (link === undefined) return false;
		if (this.actions.keybindings?.matches(data, "app.message.copy") !== true) return false;
		void (this.actions.copy ?? copyToClipboard)(link.url).then(
			() => {
				this.copyNote = "copied";
				this.tui.requestRender();
			},
			(error: unknown) => {
				this.copyNote = error instanceof Error ? error.message : "copy failed";
				this.tui.requestRender();
			},
		);
		return true;
	}

	private linkHint(): string {
		const keys = this.actions.keybindings?.getKeys("app.message.copy") ?? [];
		const copy = this.copyNote ?? (keys.length > 0 ? `${keys.join("/")} to copy` : "copy");
		const click = process.platform === "darwin" ? "cmd+click" : "ctrl+click";
		return this.theme.fg("dim", `${click} to open   ${copy}`);
	}

	private settle(value: string): void {
		const pending = this.pending;
		this.pending = undefined;
		this.tui.requestRender();
		pending?.resolve(value);
	}

	private cancel(): void {
		const pending = this.pending;
		this.pending = undefined;
		this.tui.requestRender();
		pending?.reject(new Error(`${this.label}: login cancelled`));
	}

	private move(data: string, count: number): void {
		if (count === 0) return;
		if (matchesKey(data, Key.up)) this.selected = (this.selected - 1 + count) % count;
		else if (matchesKey(data, Key.down)) this.selected = (this.selected + 1) % count;
		else if (matchesKey(data, Key.enter)) {
			const pending = this.pending;
			const option =
				pending?.prompt.type === "select" ? pending.prompt.options[this.selected] : undefined;
			if (option !== undefined) this.settle(option.id);
			return;
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}
		this.tui.requestRender();
	}

	private promptRows(inner: number): string[] {
		const pending = this.pending;
		if (pending === undefined) return [this.theme.fg("dim", "waiting...")];
		const room = Math.max(1, inner - 2);
		const asked = this.theme.fg("text", truncateToWidth(pending.prompt.message, inner));
		if (pending.prompt.type === "select") {
			const options = pending.prompt.options.map((option, index) => {
				const pointer = index === this.selected ? this.theme.fg("accent", "❯ ") : "  ";
				const label = index === this.selected ? this.theme.bold(option.label) : option.label;
				return `${pointer}${truncateToWidth(label, room)}`;
			});
			return [asked, ...options];
		}

		const value = this.input.getValue();
		const shown =
			pending.prompt.type === "secret" && value !== "" ? "•".repeat(value.length) : value;
		const field =
			shown === ""
				? this.theme.fg("dim", truncateToWidth(pending.prompt.placeholder ?? "", room))
				: `${shown}${this.theme.fg("accent", "▎")}`;
		return [asked, `${this.theme.fg("accent", "❯ ")}${field}`];
	}

	private hint(): KeyHint[] {
		return this.pending?.prompt.type === "select"
			? [
					["↑↓", "move"],
					["enter", "choose"],
					["esc", "cancel"],
				]
			: [
					["enter", "submit"],
					["esc", "cancel"],
				];
	}
}
