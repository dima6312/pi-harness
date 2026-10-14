# How the harness draws

The harness has opinions about how it looks, so it has few appearance settings: the icon set, which
depends on the terminal's font, the frame's line style, and whether your messages are framed. Colors
come from the active pi theme, which follows the terminal by default. The look is in the shapes, not
in a palette.

Every dialog the harness opens wears the same frame and follows the same rules, whatever its size or
place. The parts live in `@adeildo/pi-kit` (`packages/kit/src/ui/frame.ts`); a package draws its
content and hands the lines to `frame()`.

```
╭─ Title ──────────────────────────────── status ─╮
│  content, two columns in from the side          │
│▌ ❯ the selected row, its label in bold          │
│  ────────────────────────────── a quiet rule    │
│  more content                                   │
╰─ ↑↓ move   enter pick   esc close ───── note ──╯
```

## The frame

- A rounded line in the theme's `border` color. Inside it, two columns of padding on each side.
- The top edge holds the title, in the accent and bold, on the left, and a status on the right: counts,
  a step like `1/2`, how many agents work.
- The bottom edge holds the keys that do something right now, as `key action`, the key in `muted` and
  the action in `dim`, three spaces apart. A note can sit on its right: what the panel cost, where you
  are in a long list.
- A second column gets a line in `borderMuted`, and the frame draws `┬` and `┴` where it meets the
  edges (`split`).
- A break inside one part is a `rule()` in `borderMuted`, with an optional note on its right, such as
  how far back you scrolled.

## No backgrounds

Nothing paints a background. A dialog is a frame on the terminal's own background, so it never clashes
with the terminal's theme and never leaves a strip of another color at its edges. Emphasis comes from
color, weight and glyphs only.

## The selected row

Three marks, always together:

1. `❯ ` in the accent in front of it (`pointer()`); the other rows keep the two columns empty so
   nothing shifts.
2. Its label in bold.
3. The accent bar `▌` against the frame's left side (`{ text, selected: true }`), when the list is the
   leftmost column.

When the list does not have the keys, as the agents in the room while you write, the pointer turns
`dim` and the bar goes away.

## Shapes

| Shape        | Where                         | Size                                             |
| ------------ | ----------------------------- | ------------------------------------------------ |
| Panel        | `Alt+G` room, `Alt+T` tasks   | Centered overlay, about 80% of the screen        |
| Full screen  | `Alt+S` settings              | The whole terminal                               |
| Inline       | Questions, permission         | In place of the editor, full width, content tall |
| Small dialog | Accounts, login, model picker | Narrow, centered, one short list                 |

All four use the same frame, the same keys and the same selection. Only the size and the place change.

## Color roles

| Role                 | Theme color   |
| -------------------- | ------------- |
| Frame                | `border`      |
| Inner lines, rails   | `borderMuted` |
| Title, pointer, bar  | `accent`      |
| Body text            | `text`        |
| Secondary text, keys | `muted`       |
| Hints, times, counts | `dim`         |
| Waits on you         | `warning`     |
| Done, success        | `success`     |

An agent or a person keeps one color everywhere it shows: its name, its spinner, the rail of a message
it just wrote.

## Space

- Text starts at the padding. Nothing indents more than it needs to: in the room a message is a header
  line and the words under it behind a two-column rail, and an answer quotes the line it answers
  above it instead of indenting.
- Times go after what they stamp, and what became of a message sits at the right end of its header,
  so the left edge stays for names and words.
- A long body shows its first lines and says how many more there are.

## Motion

Something moves only to say something changed: a spinner while an agent works or writes, a lit rail
for a few seconds on a message that just arrived, a blinking cursor where words arrive, the mark of a tool call that is writing, waiting or running:
a pencil inking, an hourglass flowing, a clock going round, each in its own cell. A still panel redraws once a
second; a moving one every frame. The start screen has the one move made for show, once per launch,
and never delays typing.

## The transcript

The model speaks without a frame. Everything else in the transcript has one: the frame's top edge
says who or what it is, and its bottom edge says what became of it and how long it took.

| Entry                        | Top edge                | Bottom edge                | Color         |
| ---------------------------- | ----------------------- | -------------------------- | ------------- |
| Your message                 | `you`                   | nothing                    | `accent`      |
| A tool call                  | its mark and name       | phase, time, what it wrote | the phase     |
| A message from an agent      | `@name → you`, the time | nothing                    | the agent's   |
| The judge's decisions        | `◈ judge`, how many     | nothing                    | `borderMuted` |
| A `!` command                | `! shell`               | done, or the exit code     | `bashMode`    |
| Pi's own (compaction, skill) | `π` and what it did     | nothing                    | `borderMuted` |
| Messages waiting to be sent  | `queued`, dashed        | the key that edits them    | `borderMuted` |

The kit draws them: `entryFrame()` is the frame, and `GLYPH` and `LINE` name every character.
A dashed frame has not happened yet. A message that leaves the queue becomes a `you` frame in the
transcript. The room (Alt+G) draws its messages the same way, and the line you write in there and
another agent's draft wear the dashed frame, because neither has been sent yet.

## The start screen

The start screen shows the pixel π, the folder, the branch and the model, and under them only what
changed or waits on you since the last session: a failed CI run, a review on an open pull request,
another agent working in the folder, a plan close to its limit, a new harness version. On a quiet day
it says so in one line. Pi's own list of loaded skills, prompts and extensions is hidden. The top edge
reads `π-harness` and its version, with pi's version on the right.

GitHub is asked once per launch, in the background, and nothing waits on the answer: the CI and pull
request lines appear when the answers arrive, and a missing `gh`, no network or a folder that is not
on GitHub leaves them out.

## Settings

`Alt+S` keeps one tab per package. The selected setting shows a preview of its effect under the list,
drawn with the real theme: the frame styles draw a tool call in each.

## Words

Labels are plain verbs in lowercase (`move`, `pick`, `close`), and an action keeps its name wherever
it shows. Empty states say what to do next. No dash as a pause in anything the user reads.
