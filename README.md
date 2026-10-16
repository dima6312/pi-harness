<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Pi runs every command without asking. This makes it ask.</strong><br>
  A set of extensions on top of <a href="https://pi.dev">Pi</a>, in one install: they ask before a command runs, and they ask you when the model would otherwise guess.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-harness</code></p>

<!-- docs:harness/conversation -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/conversation.png" alt="A session with the look: the start card, a request, the model running the tests, committing and pushing, then the stopwatch, the task under way, the editor and the cost." width="860">
  <br>
  <em>A session: the start card, what you asked, what the model ran, and what it cost.</em>
</p>

<!-- /docs -->

## What changes

**Every command says who let it run.** A small model reads it first. When it is sure the command is fine it runs and says how sure it was; when it is not, the command comes to you with the reason it is asking.

**One dialog answers both.** A permission ask and a question from the model look the same and take the same keys: yes, always yes or no, with a note you can leave on any answer. Saying no to `npm install` with "use pnpm instead" reaches the model.

**The line you type on never moves.** The time, the cost and how fast the model writes change around it, every answer can be undone, and `Alt+S` shows what each piece is set to.

## What you get

| Piece                                 | What it does                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Permission](packages/ask-permission) | Asks before a command runs. A model answers the easy ones for you, with the reason on the command, and the ones it is not sure about come to you                                                                                                           |
| [Questions](packages/ask-questions)   | The model asks instead of guessing, with options, a preview of what each one leads to, and a note on any of them                                                                                                                                           |
| [Tasks](packages/tasks)               | Keeps what the session is doing, what it did and with what result, what waits on you, and what was decided. The judge reads it as your intent                                                                                                              |
| [Compact](packages/compact)           | Hides old tool output once the context passes 150k tokens, which cut a week of real sessions' cost by a third. pi's compaction summary comes from the tasks                                                                                                |
| [Peers](packages/peers)               | Agents in the same folder see each other's tasks and what they ran, talk in a room, hear what you tell everyone, and split what you ask anyone                                                                                                             |
| [Skill calls](packages/skills)        | Call the skills you already have from anywhere in a message, several at once. The model reads each in full, and the chat shows a chip                                                                                                                      |
| [Look](packages/look)                 | The start screen, the editor with the branch and the model on its borders, and a box around each command with its output and how long it took                                                                                                              |
| [Providers](packages/providers)       | Bills Anthropic requests to the Claude plan you already pay for, keeps several accounts with a switch to the next one when a limit hits, keeps the prompt cache warm while you are likely to come back, and adds OpenAI-compatible endpoints from `/login` |

Both dialogs open in the same frame and take the same keys, and a note on any answer reaches the model.

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/permission.png" alt="The permission dialog for npm install, narrow: the command, the reason it asks, the three answers, the note on no, and the keys." width="380">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/questions.png" alt="The question dialog, narrow: two tabs, the options, and the panel with the description and the preview below them." width="380">
  <br>
  <em>The permission ask and a question from the model: the two dialogs that need you.</em>
</p>

## One piece, or all of them

`@adeildo/pi-harness` brings every piece, and `pi config` turns any of them off. Each piece is also its own package: `pi install npm:@adeildo/pi-look` brings the screen and nothing else.

There is no fork. Everything installs on top of Pi, and `pi remove` puts Pi back the way it was.

## Where to read next

| You want                        | Read                                                  |
| ------------------------------- | ----------------------------------------------------- |
| Use a piece                     | The page of the piece, linked in the table above      |
| Look up a setting or a key      | The piece's own `docs/reference.md`, where it has one |
| Know what is planned            | [ROADMAP.md](ROADMAP.md)                              |
| Know what changed               | [CHANGELOG.md](CHANGELOG.md)                          |
| Build a piece, or send a change | [CONTRIBUTING.md](CONTRIBUTING.md)                    |

## Credit

The pieces borrow from other people's work, and each page names where. In one line: [pi-open-tui](https://github.com/OldSuns/pi-open-tui) and [oh-my-pi](https://github.com/can1357/oh-my-pi) for the screen, [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) for the questions, [pi-claude-max](https://github.com/bradennss/pi-claude-max) for the Claude plan billing, and [pi-multiprovider](https://github.com/monotykamary/pi-multiprovider) for pooling accounts of one provider.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
