<h1 align="center">@adeildo/pi-kit</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-kit"><img src="https://img.shields.io/npm/v/@adeildo/pi-kit" alt="npm"></a>
</p>

<p align="center">
  <strong>The library under every piece of <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a>.</strong><br>
  An app builder, a feature scope, settings that several extensions share, and the settings screen on <code>Alt+S</code>. The screen is the one thing it adds to Pi.
</p>

<p align="center"><code>npm install @adeildo/pi-kit</code></p>

It is a library and not a Pi package. Its API follows what the packages need, with no promise to anyone else.

## An app, and features in it

```ts
import { createApp, defineFeature, matching, setting } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const version = setting({
	id: "subscription.claudeCodeVersion",
	default: "2.1.280",
	decoder: matching(/^\d+\.\d+\.\d+$/, "a version like 2.1.280"),
});

export const subscription = defineFeature({
	id: "subscription",
	description: "Bill Anthropic OAuth requests to the Claude plan",
	settings: [version],
	setup(scope) {
		scope.on("before_provider_headers", (event) => {
			event.headers["user-agent"] = `claude-cli/${version.get(scope)}`;
		});
	},
});

export default function (pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(subscription).build();
}
```

Each extension a package declares is one app with one or more features. The app's `name` goes in front of every warning. The harness declares one extension per feature, so `pi config` turns each off on its own, and all of them read the same settings file.

## What a feature gets

`setup` receives the feature's scope. It extends `ExtensionAPI`, so every pi method is there, with these wired to the feature:

| Scope                   | Does                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scope.on`              | `pi.on`, with errors that read `pi-harness: permission: tool_call: boom`. It still throws, because a `tool_call` handler that throws is how pi blocks a tool |
| `scope.registerCommand` | `pi.registerCommand`. If another feature in the same app took the name, this one is skipped with a warning                                                   |
| `scope.onSessionStart`  | Runs once the session's settings are loaded. Anything that lasts, like a watcher or a child process, starts here and never in `setup`                        |
| `scope.onShutdown`      | Runs once per session, newest first, even when pi fires `session_shutdown` twice                                                                             |
| `scope.screen`          | Rows on the settings screen that are not settings                                                                                                            |
| `scope.warn`            | Shows a notification when there is a UI, and writes to stderr when there is not. Messages sent before a session starts wait for it                           |
| everything else         | The scope is the extension API, so `scope.registerTool`, `scope.appendEntry`, `scope.events` and the rest work as they always did                            |

A `setup` that throws turns into a warning and the other features still mount. If two apps in one Pi process mount the same feature id, the first runs it and the second logs who has it.

## Settings

Every app reads `~/.pi/agent/extensions/pi-harness/settings.json`. A setting's `id` is its path in that file. A store reads only the settings its own features declared, so keys belonging to another app never produce a warning.

`store.set` writes one value and `store.setAll` several in one pass, which is what a feature does when it saves a whole config object. A value that already reads the same is not written, so the file holds what was decided and not a copy of every default, which would freeze them.

A setting with `project: true` also reads `<project>/.pi/extensions/pi-harness/settings.json`, but only once pi trusts the project, and the project value wins there. Anything without that flag is global, and a project file that tries to set it gets a warning, so a cloned repository cannot loosen what runs without asking.

A value that fails to decode is ignored, and the warning names the file and the key.

## The settings screen

`Alt+S` or `/harness` opens it. Each feature is a tab, and the rows come from two places.

A setting with a `ui` gets a row:

```ts
export const cursor = setting({
	id: "look.frame.cursor",
	default: "bar",
	decoder: literal("block", "bar", "underline"),
	ui: { section: "Editor", label: "Cursor", description: "The editor's cursor." },
});
```

The decoder picks the editor: `boolean` is a toggle, `literal` a choice, `integer` a number, `stringList` a list. `ui.control` labels the options or adds presets.

Anything else goes through `scope.screen`: `value` for session state, `action` for something to run, `info` for a fact.

```ts
scope.screen.action({
	id: "judge.test",
	section: "Judge",
	label: "Test the judge",
	description: "Sends one real request.",
	run: (ctx) => probe(ctx),
});
```

A value typed on the screen goes through the same decoder as the file. The feature options `tab` and `sections` set the tab name and the section order.

## Turning a feature off

Every feature also gets `features.<id>.enabled`, on by default. A feature that is off never runs `setup`, so it registers nothing and costs nothing. The change lands on the next `/reload`.

## Events and contracts

```ts
const accountChanged = defineEvent("providers:account-changed", object({ account: string }));

accountChanged.on(scope, ({ account }) => …);
accountChanged.emit(scope, { account: "work" });
```

Events travel over `pi.events`, on the channel `harness:<name>`. Two features behave the same whether they share an app or come from different packages. The payload may come from an older or newer version of the other package, so it is decoded when it arrives, and one that does not decode is dropped with a warning.

These rules hold for every event that crosses packages:

- It is declared in `contracts/` here, never in the package that emits it. The listener then does not depend on the emitter, and either one works without the other.
- The payload is plain JSON, with no functions, classes or `Date`, so a remote control or a web UI can forward any contract without knowing what is inside.
- A payload can gain fields but never lose them.

## Testing

`@adeildo/pi-kit/testing` has `fakePi()`, `fakeScope()` and `fakeContext()`. Two fakes on one `createEventBus()` behave like two extensions in the same Pi process, and `fire` runs the handlers in order and returns what each one returned.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

## License

MIT

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
