<h1 align="center">@adeildo/pi-compact</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-compact"><img src="https://img.shields.io/npm/v/@adeildo/pi-compact" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Keeps a long session's context small, so each request costs less.</strong><br>
  Old tool output goes. The agent's words, your words and the decisions stay.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-compact</code></p>

## What it does

Past 150k tokens of context, tool output older than the last 10 turns becomes one line that names its call:

```text
Output hidden to save context, about 4.2k tokens. It came from: read src/view.ts. Run it again if you need it.
```

Long arguments go the same way, like a script sent to bash or a file sent to write. Your messages, the agent's own words, errors and the last 10 turns stay whole. After a prune the agent gets the session's [tasks](../tasks) at the end of its context, so it keeps its goals.

Each prune leaves a line in the chat. Expand it to see the calls it hid.

```text
✂ Hid 38 old tool outputs to save context: 412k → 168k tokens
```

When pi compacts anyway, the summary is the tasks, your words and the files touched, plus the facts a small model finds missing. The decisions go in as they are, so no model rephrases them. Without tasks, pi writes its own summary.

## Why this way

- Hiding old tool output works as well as summarizing it and costs less. Summaries made agents run 13 to 15% longer ([JetBrains, NeurIPS 2025](https://arxiv.org/abs/2508.21433)).
- A model that picks what to keep cost 94% more with no gain in quality ([OpenHands, 2026](https://arxiv.org/abs/2605.18854)). The rules here are plain code.
- Every edit rewrites the prompt cache ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-editing)), so a prune waits until it frees at least a fifth of the context at once. Without that, the same sessions cost 12% more.
- Errors stay and every placeholder keeps its call, after [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).

Replaying a week of real sessions through it, mostly Opus with a 1M context, costs 34% less, the cache rewrites included. `bun packages/compact/eval/replay.ts` replays yours.

## With pi's compaction

Nothing of pi's is turned off. The prune runs at the end of each turn, right before pi checks its own compaction threshold, so pi rarely needs to compact. `/compact` and auto-compaction still work; this package only writes their summary. The prune is a `context_edit`, so the session file keeps every output, and `/tree` to an earlier point shows them again.

## Commands and settings

`/prune` hides old output at the end of the next turn, whatever the context's size.

On the Compact tab of `Alt+S`, stored under `compact` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting                 | Default  | Does                                                                      |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| Hide old tool output    | on       | The prune                                                                 |
| Above                   | `150000` | Context tokens that start a prune                                         |
| Write it from the tasks | on       | pi's compaction summary from the tasks. Off, pi writes its own            |
| Model                   | `auto`   | Finds the missing facts. `auto` is the cheapest of the session's provider |

The tab also shows what this session's prunes freed and how many hidden outputs the agent ran again. A high share means the prune hides what the agent still needs.

## License

MIT
