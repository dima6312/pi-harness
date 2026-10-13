<h1 align="center">@adeildo/pi-providers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-providers"><img src="https://img.shields.io/npm/v/@adeildo/pi-providers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>The plan you already pay for, and more than one login per provider.</strong><br>
  Bill Anthropic requests to your Claude plan, and keep several accounts with a switch to the next one when a limit hits.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-providers</code></p>

## Claude plan

With a Claude Pro or Max plan connected through `/login anthropic`, Pi's requests count as extra usage, billed by the token. This makes them come out of the plan, the way Claude Code's own requests do.

> [!WARNING]
> It does that by introducing Pi to Anthropic as Claude Code, and using a subscription from anything other than Claude Code may break Anthropic's terms. It is on as soon as you install the package. To say no to that: switch the extension off in `pi config`, or set `"features": { "subscription": { "enabled": false } }` in the settings file below.

Pi already sends Claude Code's identity when the token is an OAuth one. Anthropic checks two more things before it bills the request to the plan:

1. The user agent has to read `claude-cli/<version> (external, cli)`.
2. The first `system` block has to be the billing attribution, with nothing Claude Code would not send. Pi's own prompt moves to the start of the first user message, wrapped in `<system-instructions>`, where the model still reads it.

Any provider that speaks the Anthropic Messages API with an OAuth token gets this, not only the one named `anthropic`, so a second account under another name is billed to its own plan. A request with an API key goes out untouched.

Pi warns about extra usage in every Anthropic OAuth session. Once the plan pays, that warning is wrong, and `warnings.anthropicExtraUsage` in `~/.pi/agent/settings.json` turns it off.

```json
{ "warnings": { "anthropicExtraUsage": false } }
```

Anthropic answers `400 claude_code_version_too_old` when it considers the version too old for a newer model, and `subscription.claudeCodeVersion` raises the version Pi reports.

## Accounts

Pi keeps one credential per provider, the one `/login` wrote. This keeps several, each with a name. Once a provider has an account, its accounts are all it has: every request, refresh and plan reading comes from the account in use, and there is no unnamed credential behind them.

```text
/accounts            the accounts of the current model's provider
/accounts anthropic  the accounts of another one
```

The list shows each account, the one in use and what its plan has left, and fills the plans in as they arrive. `enter` uses an account, here and in the sessions that start after, `r` renames it in place, `d` removes it after asking, and `a` or the last row adds one. Adding asks for a name and runs the login Pi already has, so there is no OAuth of its own here. The first account of a provider brings Pi's own login along under a name you choose, since from then on only accounts are read.

A `/login` for a provider that already has accounts asks where the credential goes, replacing an account or becoming a new one, and closing that dialog still keeps it as a new account under the provider's name. Pi keeps its own copy too, because it decides which providers are logged in before any extension starts; that copy is renewed from an account and never read for a request. Each account shows its kind:

| Kind    | Is                                           |
| ------- | -------------------------------------------- |
| `oauth` | A subscription token, billed to its own plan |
| `key`   | An API key                                   |

`alt+a` switches the account of the current model's provider for this session, and the Providers tab of `Alt+S` lists them too. The account in use sits next to the model, and its plan's windows below the editor, read again whenever a model of another provider is picked. An account whose credential the provider refused says `sign in again`, and `enter` on it in `/accounts` signs in again under the same name. The session remembers the choice, so a resume or a fork comes back to the same one.

When a provider refuses a request for a quota or a rate limit and that provider has another account, `accounts.onLimit` decides what happens:

| Value    | Does                                                                      |
| -------- | ------------------------------------------------------------------------- |
| `ask`    | Opens a dialog, with an option to always switch from then on. The default |
| `switch` | Moves to the next account on its own                                      |
| `stop`   | Leaves the error in front of you                                          |

Only a limit that arrives before anything was shown switches, so a retry never repeats output you already saw. Only chat streams move: image generation, classifier calls and deferred responses use the account in use, and surface their errors as they are.

A quota belongs to the account, so an account that refused is skipped until it answers again, and the same dialog is not asked twice in a session. A credential the provider refuses instead opens `accounts.onAuthFailure`, whose dialog can run the provider's own login again under the same account, keeping its name and the session pin.

## Settings

In `~/.pi/agent/extensions/pi-harness/settings.json`:

| Key                              | Default     | Does                                                                                           |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `subscription.claudeCodeVersion` | `"2.1.280"` | The version Pi reports. Anthropic will not serve newer models to a version it considers old    |
| `accounts.onLimit`               | `"ask"`     | What a quota or a rate limit does when another account exists: `"ask"`, `"switch"` or `"stop"` |
| `accounts.onAuthFailure`         | `"ask"`     | What a refused credential does: `"ask"` (sign in again or switch), `"switch"` or `"stop"`      |

The Claude plan billing comes from [pi-claude-max](https://github.com/bradennss/pi-claude-max) by Braden Lamb, MIT. This is a rewrite: it reads the version from settings, carries pi's cache breakpoints over instead of dropping the one-hour TTL, moves every system block after the identity instead of only the second, and checks for an OAuth token instead of the provider name.

Several accounts per provider, with a switch to the next one when a limit hits, follow [pi-multiprovider](https://github.com/monotykamary/pi-multiprovider) by monotykamary, also MIT. This one keeps them inside pi's own login, with no OAuth of its own.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
