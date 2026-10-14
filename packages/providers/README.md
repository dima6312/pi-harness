<h1 align="center">@adeildo/pi-providers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-providers"><img src="https://img.shields.io/npm/v/@adeildo/pi-providers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>The plan you already pay for, and more than one login per provider.</strong><br>
  Bill Anthropic requests to your Claude plan, keep several accounts with a switch to the next one when a limit hits, and keep the prompt cache warm while you are likely to come back.
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

Anthropic answers `400 claude_code_version_too_old` when it considers the version too old for a newer model, so the version Pi reports is pinned in `src/subscription/claude-code.ts`, and the workflow that reverse engineers Claude Code moves it when a release lands. That file also holds the features Claude Code asks for in `anthropic-beta`, and the settings pick which of them go out.

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

## Prompt cache

Anthropic keeps a prompt in cache for 5 minutes. With pi's `cacheWarming` setting on `idle`, pi sends the last request again before the 5 minutes end, while the agent waits for you. Your next message then reads the prompt from cache instead of writing all of it again. On Opus 5.5 a refresh reads the prompt at 5% of the input price, and a miss writes it at 125%.

Pi assumes a fixed 15% chance that you come back before each refresh, and refreshes only when that saves 5 cents. On Opus 5.5 it skips every prompt under about 96k tokens, and refreshes the rest for 30 minutes. The chance falls the longer you are away, so `cache.strategy` picks how refreshes are decided:

| Value     | Refreshes                                                                                    |
| --------- | -------------------------------------------------------------------------------------------- |
| `learned` | While the chance you come back pays for the refresh, whatever the prompt's size. The default |
| `pi`      | As pi decides on its own                                                                     |
| `minutes` | Every time in the first `cache.upTo` minutes after the last request, then never              |
| `off`     | Never while you are away                                                                     |

`learned` measures how long you took to answer after each run, in the last 30 days of sessions of every project. It reads them once a day, in the background. Runs that ended on a question to you are counted apart, because you answer those sooner. Until it has learned, it uses the chances measured on 1,688 runs:

| Away for         | Chance of a message before the next refresh |
| ---------------- | ------------------------------------------- |
| 4.5 to 9 min     | 28%                                         |
| 9 to 13.5 min    | 12%                                         |
| 13.5 to 18 min   | 7.4%                                        |
| 18 to 22.5 min   | 6%                                          |
| 22.5 to 31.5 min | 3.5%                                        |
| more             | 1.5%                                        |

A refresh goes out when that chance times the cost of a miss is more than the cost of the refresh. That is about 23 minutes on Opus 5.5, which reads cache at 5% of its input price, and about 14 on Sonnet 4.6, which reads at 10%. The Providers tab of `Alt+S` shows what was learned and how long it keeps the current model warm.

A restart or `/reload` stops the refreshes, since they run inside pi.

## Settings

In `~/.pi/agent/extensions/pi-harness/settings.json`:

| Key                      | Default            | Does                                                                                           |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------- |
| `subscription.betas`     | Claude Code's turn | The `anthropic-beta` headers an OAuth request asks for, beside the ones pi works out itself    |
| `accounts.onLimit`       | `"ask"`            | What a quota or a rate limit does when another account exists: `"ask"`, `"switch"` or `"stop"` |
| `accounts.onAuthFailure` | `"ask"`            | What a refused credential does: `"ask"` (sign in again or switch), `"switch"` or `"stop"`      |
| `cache.strategy`         | `"learned"`        | How refreshes between runs are decided: `"learned"`, `"pi"`, `"minutes"` or `"off"`            |
| `cache.upTo`             | `20`               | Minutes `"minutes"` keeps refreshing after the last request                                    |

The Claude plan billing comes from [pi-claude-max](https://github.com/bradennss/pi-claude-max) by Braden Lamb, MIT. This is a rewrite: it pins the version, carries pi's cache breakpoints over instead of dropping the one-hour TTL, moves every system block after the identity instead of only the second, asks for the betas Claude Code asks for, and checks for an OAuth token instead of the provider name.

Several accounts per provider, with a switch to the next one when a limit hits, follow [pi-multiprovider](https://github.com/monotykamary/pi-multiprovider) by monotykamary, also MIT. This one keeps them inside pi's own login, with no OAuth of its own.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
