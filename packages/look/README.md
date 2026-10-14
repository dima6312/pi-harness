<h1 align="center">@adeildo/pi-look</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-look"><img src="https://img.shields.io/npm/v/@adeildo/pi-look" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Pi's screen, drawn around the numbers that matter while the agent works.</strong><br>
  The start card, the editor framed with the branch and the model, a box around every command, and a footer with what the session costs.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-look</code></p>

<!-- docs:look/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/preview.png" alt="Pi with the look: the start card, then the strip with the stopwatch and the last call, the task under way with how many wait, are queued and are done, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds." width="860">
  <br>
  <em>The start card, then a prompt halfway through its answer.</em>
</p>

<!-- /docs -->

<!-- docs:look/call -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/call.png" alt="Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running." width="420">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/settings.png" alt="The settings screen in a frame, titled Settings. The Look tab holds Appearance, Your messages and What is on screen, with Editor frame selected. Under the list, the preview draws the editor's rounded frame with main on the top edge, the folder on the right, the model on the bottom edge and the context on the right. Below, the setting's name and default, and the keys along the bottom edge." width="420">
  <br>
  <em>Every command in a box, and a setting shown before you keep it.</em>
</p>

<!-- /docs -->

## The screen

A finished answer takes a box of its own, so you can see what the model wants to run before it runs. The mark of the tool and its name sit on the top line, the command under them, and the reason it was allowed under that, when another model answered it. A line cuts the command off from what it printed, and the bottom line says how it went: a check, a cross, and how long it took. A command still running says `running` with the time so far. A tool from an MCP server shows its server and tool instead of `mcp__server__tool`. A tool with no drawing of its own, like the memory calls, gets the same box with its name and arguments on top and its text under the cut.

The strip above the editor is calm on purpose. Nothing moves while the model streams except the stopwatch.

| Piece                                            | Means                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `0:12  3 calls`                                  | How long the agent has worked on this prompt, and how many calls to the model it made                   |
| `last call 1.7s wait  900ms thought  ↓906 tok/s` | The last call: how long the model took to start, how long it thought then wrote, and how fast it writes |

The border around the editor carries the branch with its distance and changes, the folder, the permission mode, the model with an effort meter, and the context. It takes pi's own effort colour, so it warms up as the model thinks harder and turns to the shell colour in bash mode.

The spinner names the state instead of saying "Working": `waiting` for the first token, `thinking`, `writing`, `drafting bash` while the model writes the call, `running bash` while it runs.

Your messages sit in a frame like the tool calls', in the accent colour and named `you`, without pi's background or the blank rows above and below the text. `look.userFrame` turns it off.

The start card shows the π, the folder, the branch and the model, and under them only what changed or waits on you since your last session in the folder: an account that needs a sign-in, files in conflict, a branch behind its remote, a failed CI run on the branch, a pull request of yours with changes requested or a new comment, other agents working there, a plan past 70%, a new harness version. On a quiet day it says nothing is new, and its bottom edge reads `ready when you are`. GitHub is asked once per launch, in the background, so the card never waits on it: those two lines appear when the answers arrive, and a missing `gh`, no network or a folder that is not on GitHub leaves them out. The π rises from its feet once per launch. With pi's `quietStartup` on `header`, which the harness sets, pi's list of everything it loaded stays out of the way.

The mark of a phase that lasts moves: a clock goes round its hours while a call runs, the hourglass flows while it waits on you, and the pencil fills with ink and empties while the model writes the call, in its own cell. With the Unicode icons a quarter circle goes round and the pencil tilts as it writes instead, and with ASCII a line spins. The mark stands still once the call ends.

Pi's own entries sit in the same frame as the tool calls: compactions and branch summaries under `π`, skills, `!` commands with a cut between the command and what it printed, and the messages of extensions that bring no renderer of their own. The messages you send while the agent works wait above the editor in a dashed frame, each marked `steer` (between the agent's calls) or `next` (after its run), with the key that takes them back to the editor in the bottom edge.

While the model writes an `edit` or a `write`, its frame shows the end of what has arrived, with a cursor where the model is writing. A write shows its last 8 lines with their numbers, and says whether it makes a new file or how many lines it replaces. An edit shows the lines it takes out and puts in. The lines it repeats around the change stay as context. The bottom rule counts the lines and the size, or the edits and the lines changed. Once the call is written, pi's own view takes over, with the diff read from the file.

The footer is the session: the cost, the tokens sent and received, the cache of the last prompt, the average speeds, and last what other packages report, because that changes the most.

## It holds still

Numbers change on every frame, and the screen must not move with them.

- Every number sits in a cell of fixed width, so `  17` and `2.8k` take the same room.
- A value nobody knows yet shows as `–` and does not appear later in the middle of the line.
- The working time counts as a stopwatch, `0:59` then `1:00`.
- An estimate is drawn quieter, so you know it is one.
- The strip and the footer hold their line from the start, so the editor does not jump when the first answer arrives.

Pi records usage without a duration, so every finished answer leaves one small entry in the session with its time to the first token and its writing time. That is what keeps the averages right after a resume.

## Your theme

The look never names a colour. Every piece names a theme token, so it follows whatever theme pi runs, and it moves with it when you change themes. The [reference](docs/reference.md#colours) maps each piece to its token.

## Settings

`Alt+S` opens them on the Look tab. You can reorder every piece of the strip, the frame and the footer, pick the frame style, the icons and the separator, and switch off what you do not want. The [reference](docs/reference.md#settings) lists every key and every segment.

The framed editor, and the idea of writing into its borders, come from [pi-open-tui](https://github.com/OldSuns/pi-open-tui), which this replaces. The segments with priorities come from [oh-my-pi](https://github.com/can1357/oh-my-pi).

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
