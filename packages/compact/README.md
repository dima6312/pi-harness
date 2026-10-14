<h1 align="center">@adeildo/pi-compact</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-compact"><img src="https://img.shields.io/npm/v/@adeildo/pi-compact" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Keeps a long session's context small, so each request costs less.</strong><br>
  It hides old tool output and keeps the agent's words, your words and the decisions.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-compact</code></p>

## What it does

When a run ends past 150k tokens of context, tool output older than the last 10 turns becomes one line that names its call:

```text
Output hidden to save context, about 4.2k tokens. It came from: read src/view.ts. Run it again if you need it.
```

Long arguments leave whole, like a script sent to bash or a file sent to write, and a note on the call says which went. A value cut short would teach the model to cut its own: in a live session, after a prune that cut values that way, the agent wrote new calls cut the same way, and they ran. A call that copies the note, or a value cut the old way, does not run. Your messages, the agent's own words, errors and the last 10 turns stay whole. After a prune the agent gets the session's [tasks](../tasks) at the end of its context, so it keeps its goals.

The prune runs when a run ends, so the cache rewrite it costs lands on your next message. When you were away longer than the cache lives, that message writes the whole prompt anyway. A turn in the middle of a run prunes only when the context passes 80% of the model's window, before pi's own compaction.

Anthropic can clear old output on its side instead, with [`clear_tool_uses`](https://platform.claude.com/docs/en/build-with-claude/context-editing), and it is off by default. It keeps the agent's thinking, which an edit drops for every later turn, because Anthropic signs each thinking block with the conversation before it. But in a session of 744 requests on Opus 5.5, each of its 15 clears made the next request write the whole prompt again, 450k to 600k tokens, to free 5% to 30% of it, since the thinking stays. Each clear cost about $2 and saved a few cents a request.

Each prune or clear leaves a line in the chat, with what rewriting the prompt cache costs and when that pays back. `Ctrl+O` lists the calls it hid.

<!-- docs:compact/prune -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/compact/assets/prune.png" alt="After a tool call, the prune's line: 181 old tool outputs hidden, 705k to 250k tokens, and below it what the next request pays to rewrite the cache and in how many requests that pays back. Then pi's cache miss notice for that rewrite." width="860">
  <br>
  <em>A prune's line, and the one cache rewrite it costs on the next request.</em>
</p>

<!-- /docs -->

When pi compacts anyway, pi's own prompt writes the summary on a small model, and the tasks and your last words go on top as they are, so no model rephrases a decision. Without tasks, pi writes the summary on the session's model.

On six recorded sessions, an agent that only had the summary answered 48 questions about what was dropped. A judge graded the answers against the truth. pi's summary on Haiku scored as well as on Opus, within the judge's noise, for 1/40 of the price. A first version that wrote its own short summary from the tasks scored 2.6 of 5 against pi's 3.9, and was dropped. The method is [Factory's probes](https://factory.ai/news/evaluating-compression), and `bun packages/compact/eval/summary.ts` runs it.

## Why this way

- Hiding old tool output works as well as summarizing it and costs less. Summaries made agents run 13 to 15% longer ([JetBrains, NeurIPS 2025](https://arxiv.org/abs/2508.21433)).
- A model that picks what to keep cost 94% more with no gain in quality ([OpenHands, 2026](https://arxiv.org/abs/2605.18854)). The rules here are plain code.
- After a prune, the next request writes the whole conversation to the prompt cache again. Anthropic reuses cache only where an earlier request wrote it ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-editing)), and the writes near old outputs have expired. So a prune waits until it frees at least two fifths of the context at once. Pruning a little every turn would cost 3.4 times as much.
- Errors stay and every placeholder keeps its call, after [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).

Replaying a week of real sessions, mostly Opus with a 1M context, costs 32% less with the prune. The replay has each prune's next request write all of the context again, so the real saving is at least that. `bun packages/compact/eval/replay.ts [--server 10]` replays yours.

## With pi's compaction

The package turns off nothing of pi's. A turn past 80% of the window prunes right before pi checks its own compaction threshold, so pi rarely needs to compact. `/compact` and auto-compaction still work; this package only writes their summary. The prune is a `context_edit`, so the session file keeps every output, and `/tree` to an earlier point shows them again. Anthropic's clearing edits nothing in the session.

## Commands and settings

`/prune` hides old output when the run ends, whatever the context's size.

On the Compact tab of `Alt+S`, stored under `compact` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting                 | Default  | Does                                                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Hide old tool output    | on       | The prune                                                                                              |
| On Anthropic's side     | off      | On Anthropic models, Anthropic clears instead of the prune, and the agent keeps its thinking           |
| Above                   | `150000` | Context tokens past which a run's end prunes                                                           |
| Write it from the tasks | on       | The tasks on top of pi's summary, written on the model below. Off, pi writes it on the session's model |
| Model                   | `auto`   | Writes the summary. `auto` is the cheapest of the session's provider                                   |

The tab also shows what this session's prunes freed and how many hidden outputs the agent ran again. A high share means the prune hides what the agent still needs.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
