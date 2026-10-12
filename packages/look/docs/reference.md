# Look reference

Everything the [README](../README.md) leaves out: the colours, every setting and segment, and how a line fits.

## Colours

The look never names a colour. Every piece names a **theme token**, so it follows whatever theme pi runs: `system`, `dark`, `light`, or a JSON of yours. Change the theme and every piece moves with it.

| What                                          | Token                                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| Folder                                        | `accent`                                                    |
| Branch                                        | `syntaxFunction`                                            |
| Ahead, staged / behind, modified / conflicted | `success` / `warning` / `error`                             |
| Machine, cache                                | `syntaxType`                                                |
| Session name                                  | `mdHeading`                                                 |
| Provider, model icon                          | `syntaxKeyword`                                             |
| Model                                         | `text`, bold                                                |
| Sent `↑`                                      | `mdLink`                                                    |
| Received `↓`, speeds, done                    | `success`                                                   |
| Time to first token, money                    | `syntaxNumber`, then `warning` past $1 and `error` past $10 |
| Context                                       | `success`, `warning` past 70%, `error` past 90%             |
| Effort meter, the π                           | `thinkingMinimal` … `thinkingMax`, one per level            |
| Labels, units, separators                     | `dim`                                                       |
| Editor frame                                  | pi's effort border colour                                   |

Syntax tokens are borrowed on purpose: a theme spends its hues there, so they give the line variety that stays in the theme's family. The table lives in `src/render/paint.ts` as `ROLE_TOKENS`, and a test fails if any entry is ever a colour instead of a token.

## Settings

They live in the file every piece shares, `~/.pi/agent/extensions/pi-harness/settings.json`, under `look.`. The ones marked _project_ are also read from a trusted project.

| Key                 | Default                                                | Does                                                                                                                                                             |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strip`             | `["elapsed", "last"]`                                  | The line above the editor. _project_                                                                                                                             |
| `stripRight`        | `["tasks"]`                                            | The right of that line. When it does not fit beside the strip, it gets its own line under it, on the left. _project_                                             |
| `frame.topLeft`     | `["branch", "session"]`                                | After the spinner. _project_                                                                                                                                     |
| `frame.topRight`    | `["path", "host"]`                                     | _project_                                                                                                                                                        |
| `frame.bottomLeft`  | `["status:pi-ask-permission:mode", "model", "effort"]` | _project_                                                                                                                                                        |
| `frame.bottomRight` | `["context"]`                                          | _project_                                                                                                                                                        |
| `below`             | `["cost", "tokens", "cache", "average", "statuses"]`   | The line below the editor. _project_                                                                                                                             |
| `belowRight`        | `["quota"]`                                            | The other side of that line, on the right edge. _project_                                                                                                        |
| `labels`            | `true`                                                 | A short word before each number: `out`, `in`, `ttft`, `wait`, `thought`, `server`, `time`, `ctx`, `cache`. Off is denser, with only the glyphs. _project_        |
| `frame.style`       | `"rounded"`                                            | `rounded`, `square`, `heavy`, `line` (pi's two rules, written into), or `off`, which leaves pi's editor alone and moves the frame slots to the footer. _project_ |
| `frame.cursor`      | `"bar"`                                                | `block`, `bar` or `underline`. The last two use the terminal's own cursor                                                                                        |
| `header`            | `"card"`                                               | `card`, `compact` (two lines) or `off` (pi's own). _project_                                                                                                     |
| `icons`             | `"auto"`                                               | `nerd`, `unicode` or `ascii`. Auto uses Nerd Font glyphs locally and plain Unicode over SSH, where the font lives on the other machine                           |
| `separator`         | `"space"`                                              | `dot`, `bar`, `slash` or `space`. _project_                                                                                                                      |
| `pathLength`        | `40`                                                   | Longest the folder may be before it loses folders from the left. _project_                                                                                       |
| `gaugeCells`        | `8`                                                    | Cells in the context gauge. `0` hides it. _project_                                                                                                              |
| `peek`              | `true`                                                 | The spinner names the state. Off, it says what pi says                                                                                                           |

### Segments

Any segment goes in any slot, in the order the slot lists them.

| Id             | Shows                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`         | The working folder, with home as `~`                                                                                                                                 |
| `branch`       | The branch, ahead `↑` and behind `↓`, staged `+`, modified `~`, untracked `?`, conflicts `!`, stashes                                                                |
| `host`         | The machine, so a pasted line says where it came from                                                                                                                |
| `session`      | The session name, once it has one                                                                                                                                    |
| `tasks`        | What the agent is doing (`+1` when it does more), then how many wait (`⚑ 1`, in yellow), are queued (`⧗ 3`) and are done (`✓ 2`, in green), from `@adeildo/pi-tasks` |
| `version`      | The pi version                                                                                                                                                       |
| `clock`        | The time                                                                                                                                                             |
| `model`        | `provider/model`, with the account in parentheses when one is in use                                                                                                 |
| `provider`     | The provider on its own                                                                                                                                              |
| `quota`        | Every window of the plan, with its percent and its reset                                                                                                             |
| `effort`       | The effort meter and level. Hidden for models that do not reason                                                                                                     |
| `context`      | Context used, the gauge, tokens over the window                                                                                                                      |
| `speed`        | This answer's speeds, received `↓` and sent `↑`                                                                                                                      |
| `wait`         | Time to the first token                                                                                                                                              |
| `server`       | The last call's time from the request leaving to the response headers                                                                                                |
| `elapsed`      | The agent's working time, as a stopwatch, and its calls                                                                                                              |
| `last`         | The last finished call: its wait, its thought time and its writing speed                                                                                             |
| `request`      | This answer's tokens, with the cache                                                                                                                                 |
| `costRate`     | This answer's cost per million tokens                                                                                                                                |
| `cost`         | The session's cost                                                                                                                                                   |
| `tokens`       | The session's tokens, with the cache                                                                                                                                 |
| `cache`        | The cache hit of the last prompt                                                                                                                                     |
| `average`      | The session's average speeds, both ways                                                                                                                              |
| `statuses`     | What other packages report through `setStatus`, minus the ones placed on their own                                                                                   |
| `status:<key>` | One package's status, by the key it passes to `setStatus`                                                                                                            |

A `status:<key>` segment is how a package gets a place of its own. [`@adeildo/pi-ask-permission`](../ask-permission) reports its mode as `pi-ask-permission:mode`, and the mode says what happens to what you type, so by default it sits in the frame next to the model instead of in the footer with everything else. `@adeildo/pi-providers` still reports its account as `pi-providers:account`, but the `model` segment draws it in parentheses, so the statuses segment skips it.

## How it fits

When a line runs out of room, the least important pieces take their short form first (the folder becomes its last part, the model loses its provider, the effort meter loses its label), and then leave, one at a time. The two sides of a border compete for the same width, so an unimportant piece on the right leaves before an important one on the left. A line never goes empty: the last piece stays and is cut.

The frame is the editor pi already has. Typing, history, autocomplete and every app key stay pi's; the class only changes what the lines look like and shifts mouse clicks by the width of the frame. The spinner is pi's, embedded through pi's own hook, and the working line only speaks through `setWorkingMessage`.
