<h1 align="center">@adeildo/pi-tasks</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-tasks"><img src="https://img.shields.io/npm/v/@adeildo/pi-tasks" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>The session's memory, kept while you work.</strong><br>
  What the agent is doing, what it did and what came out of it, what waits on you, and what was decided.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-tasks</code></p>

## What it keeps

```text
Session: OAuth for the MCP server
Doing:
- Round the corners of the README images
Waiting:
- Commit and push straight to main (on you: production has no SECRET yet)
Queued:
- Explain the auth mode in .dev.vars.example
- Write the 1.0.0 release notes
Done, newest first:
- Show loading while history arrives → progress bar on /status (left: not tried with a real phone sync)
- Use one secret with an auth mode → SECRET and AUTH_MODE, 53 tests pass
Decided:
- One SECRET with a mode: API_KEY, OAUTH or BOTH
```

Each task is in one of six states:

| State      | Means                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| `doing`    | The agent is on it. Several tasks can be, since one run often works on what you asked mid-way |
| `queued`   | You asked for it and the agent has not started. Three runs that pass over it mark it stale    |
| `waiting`  | It stopped on you, like a push the agent asks about, or on something outside, like a build    |
| `deferred` | You put it off                                                                                |
| `done`     | Finished, with its result (a commit, a URL, a number) and what it left out                    |
| `dropped`  | You gave it up, or it repeated another task                                                   |

The list keeps decisions apart from tasks. A decision is a choice you made, or one the agent reported, that someone reading the session later must not undo.

The model writes every task in the language of your messages, as a short imperative that says what changes for you, not which file changed.

## Where it shows

<!-- docs:tasks/panel -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/tasks/assets/panel.png" alt="The session's tasks over the chat: the session as the title, one task under way, one waiting on you with the cursor on it, two queued, four done with the time each finished, one decision, and a pane with the selected task's reason." width="860">
  <br>
  <em>Alt+T: what the agent is doing, what waits on you, what is queued, what got done and what was decided.</em>
</p>

<!-- /docs -->

`Alt+T` opens the tasks over the chat, by state, with the decisions at the end. The arrows move a cursor, and the pane at the bottom shows the task under it in full: its result, what it left out, why it waits, and when it was asked, started and closed. `d` shows the dropped tasks, and `Esc` closes it. It updates while open.

The keys change the task under the cursor, and the footer lists the ones that fit it: `Enter` puts it under way, `x` marks it done, `p` defers it and `Backspace` drops it. What you do here counts as yours, like a message, and a task you drop comes back with `d` and `Enter`.

Pi's footer shows what the agent is doing. With [`@adeildo/pi-look`](../look), the task sits on the right of the line above the editor, with how many wait, are queued and are done.

`Alt+S` has a Tasks tab where you edit the session's title, what the agent is doing and what is queued, and read what waits, what got done and what was decided.

## How it stays current

Nobody writes it. A small model reads the list and only what changed, and answers with operations, never a whole new list, so it cannot rewrite what happened. It runs at three moments.

**Your message.** The model reads it beside what the agent said just before it, which is what a short "yes, do it" answers. A long message keeps its start and its end, since what you ask of something you pasted usually comes after it. It can start a task, continue one, defer it, drop it, mark it done when you say you did it yourself, record a decision, and set the session's title once, in 2 to 5 English words that fit `/resume`. A correction like "it came out misaligned" continues the task it is about, and reopens it when it was done. A question or a pasted status changes nothing. Your answers in the questions dialog of [`@adeildo/pi-ask-questions`](../ask-questions) count as a message of yours, so the option you pick or the note you leave can settle a decision or approve a task.

What you ask between runs is what the agent does now, and what it was doing waits its turn. What you ask while the agent works waits in `queued`, and nothing is pushed aside, since the agent usually takes it on in the same run.

**The end of a run.** The model reads the whole run, every message you sent during it included, as numbered lines, and gives a verdict for every open task: untouched, done with its result, still in progress, or waiting on you or on something outside. Going through all of them is what catches the task you queued mid-run and the agent did in the same commit as another. It can also record a decision the agent reported. It never adds a task: only your messages do, and what a task left out goes in its `left`, where the next task you ask for can pick it up. Tasks close only here, because mid-run the agent's words say what it does next more than what it did.

**The tidy pass.** After each run, the model looks at the whole list. It merges two tasks that say the same work, renames a task into your language, and moves the title when the session moved or was not short English. It never closes anything.

## Every change needs the words that show it

To mark a task done at the end of a run, the model cites the line that reports it, like `L12`. The extension accepts the close only when that line:

- is the agent's own words, not a tool call and not your message,
- reports the work instead of announcing it (`I'll push now` and `Agora o roteador:` before a call do not count),
- was written after the task existed,
- does not come right after a call that failed or that you refused.

A done that fails these checks stays in progress. A task waits only on the line where the agent asks you or says what it waits on, and without one it stays as it was.

The checks read your messages too. A new task needs your words that ask for it, so a plan you pasted does not become one task per step. A decision needs the alternative you turned down, so a step you confirm ("we tag v1.0.0 and release it") is not one. When you say you did something yourself, your words have to name the task and say it happened: "it worked" and "let's push" close nothing. Every refused operation stays in the session entry under `rejected`.

## Only your words become the intent

The permission judge of [`@adeildo/pi-ask-permission`](../ask-permission) reads the session's title and what the agent is doing as your intent, beside your last message, and only where they came from your messages or from `Alt+S`. A task the model renamed after the agent's work never reaches it. The model never sees what a tool returned, so instructions inside a file or a page cannot become the intent the judge reads. The one result it reads is your answers in the questions dialog, because you wrote or picked them.

## Who else reads it

The extension writes each change as a `pi-tasks:update` entry in the session, with the operations, what set them off, the entries the model read (`covers`), the model, what it cost and the resulting list. Each task keeps the entries of your messages that asked for it (`asks`) and the entries where it started and closed, so a reader can open that part of the conversation. The current list is the last update on the branch, so it follows `/tree` and forks.

- Other packages read the live list through `currentTasks()` in `@adeildo/pi-kit`, and anything that reads the session file reads it with `tasksFromEntries()`.
- `describeTasks()` writes it out for a reader without the chat, like another agent or a compaction that drops the history and keeps the decisions.

Sessions recorded by `@adeildo/pi-goal` open as tasks: the step under way is `doing`, what you put off is `deferred`, and what a new ask pushed aside is `queued`.

## Measuring it

`bun run tasks:eval` runs the cases in [`eval/cases.ts`](eval/cases.ts) against Claude Haiku, three times each (`--runs 5` for five), and says which ones the tasks got right. The cases come from real sessions. The main one is a 30-minute run during which six of your messages arrived, and the goal timeline left it as one closed step and five items in `later`. `bun packages/tasks/eval/replay.ts <session.jsonl>` plays a recorded session through the tasks, message by message and run by run, and prints what they would have kept, with the line each refused close cited. `bun packages/tasks/eval/extract.ts <session.jsonl>` prints a session as the model reads it, to cut new cases from. It signs in with an Anthropic account of [`@adeildo/pi-providers`](../providers).

## Settings

On the Tasks tab of `Alt+S`, stored under `tasks` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting          | Default | Does                                                                                                                                            |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Model            | `auto`  | `auto` is the cheapest model of the session's provider, `session` the one you talk to, or any model. When it fails, the session's model answers |
| Name the session | on      | Names the session after its title, so `/resume` and the look show it instead of your first message. A name you give with `/name` stays          |

Each call is one short request. With Claude Haiku it takes about 3 seconds and costs about $0.003, and a turn makes two or three: your message, the end of the run and the tidy pass. Every call records what it cost, even one that changed nothing (`pi-tasks:usage`). The Tasks tab shows the total, and the look adds it to the session's cost. Updates run only when pi has a UI, so print runs and subagents make no extra calls.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

## License

MIT

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
