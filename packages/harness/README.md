<h1 align="center">@adeildo/pi-harness</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Pi runs every command without asking. This makes it ask.</strong><br>
  Every piece of this repository in one install: the permission, the questions, the screen and the Claude plan.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-harness</code></p>

<!-- docs:harness/conversation -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/conversation.png" alt="A session with the look: the start card, a request, the model running the tests, committing and pushing, then the stopwatch, the task under way, the editor and the cost." width="860">
  <br>
  <em>A session: the start card, what you asked, what the model ran, and what it cost.</em>
</p>

<!-- /docs -->

## What comes in it

| Piece                           | What it does                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Permission](../ask-permission) | Asks before a command runs, with a note the model reads. A model answers the easy ones for you                           |
| [Questions](../ask-questions)   | The model asks instead of guessing, with options, a preview of each, a note on any and your own answer                   |
| [Tasks](../tasks)               | Keeps what the session is doing, what it did and with what result, what waits on you, and what was decided               |
| [Compact](../compact)           | Hides old tool output in long sessions to cut what each request costs, and writes pi's compaction summary from the tasks |
| [Peers](../peers)               | Agents in the same folder see each other's work, talk in a room, and split what you ask everyone                         |
| [Skill calls](../skills)        | Call the skills you already have from anywhere in a message, several at once, shown as chips                             |
| [Look](../look)                 | The start screen, the editor with the branch and the model on its borders, and a box around each command                 |
| [Providers](../providers)       | Bills Anthropic OAuth requests to your Claude plan, and keeps several accounts per provider                              |

All of them are on once the package is installed.

> [!WARNING]
> Providers makes Pi introduce itself to Anthropic as Claude Code whenever a request uses an Anthropic OAuth token. Using a subscription from anything other than Claude Code may break Anthropic's terms. Turn it off, as below, if you do not want that. A request with an API key goes out untouched.

## Turning a piece off

Each piece is its own extension in this package, so `pi config` switches off the one you do not want, globally or for one project. The settings file has a switch per feature too, read on the next `/reload`, and the feature ids are `permission`, `look`, `subscription`, `accounts`, `questions`, `skills`, `tasks`, `compact` and `peers`.

```json
{ "features": { "subscription": { "enabled": false } } }
```

To have only one piece, install its own package instead. With both installed, the first copy that loads runs the feature and the other stays off.

## Settings

`Alt+S` opens the settings of every piece. They live in `~/.pi/agent/extensions/pi-harness/settings.json`, and each piece's page lists its own. A setting marked _project_ is also read from `.pi/extensions/pi-harness/settings.json` in a project Pi trusts, where the project value wins.

The whole set, with the pictures and the settings of each piece, is in the [root README](https://github.com/felipeadeildo/pi-harness).

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which is this package. Every piece also ships on its own, for whoever wants only that one.

## License

MIT

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
