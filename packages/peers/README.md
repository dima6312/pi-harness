<h1 align="center">@adeildo/pi-peers</h1>

<p align="center">
  Agents working in the same folder see each other's work, talk in a room, and split what you ask everyone.
  <br>
  <a href="../../README.md">The harness</a> · <a href="../tasks">Tasks</a> · <a href="../compact">Compact</a>
</p>

Start pi in another terminal in the same folder and it appears here. There is no broker, no daemon and no server. Every session writes its own log in `~/.pi/agent/harness/events/<folder>/` and reads the others' logs. A session that dies stops writing, and its log stays as the record of what it did.

## The two ways they keep in touch

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The room panel: on the left oauth working four minutes on the OAuth callback and waiting on you to push, migration idle with two queued, and this session rewriting the README. On the right your request to switch the login to OAuth, both bids, oauth taking it, oauth asking migration about src/auth.ts, migration's answer, and oauth's commit." width="860">
  <br>
  <em>Alt+G: the agents in this folder and what each is doing, beside the room you all talk in.</em>
</p>

<!-- /docs -->

**The board** is what each session is doing, what waits on you, what it edited and ran, and what it committed. Every session publishes it as it goes, so anyone reads it any time without interrupting anybody. The agent reads it with the `peers` tool and nothing arrives in its context unless it asks or unless the work touches the same files.

**The room** is a conversation. Everyone in the folder reads it, you included, and you type in it with `Alt+G`. A message with `@name` goes to that agent. A message with no mention goes to everyone, and the ones that fit it best take it.

Press `Alt+G` to open it, and the footer keeps one mark per other agent: filled while it works, hollow while it is idle, a flag when it waits on you, plus `@N` when someone asked for your agent and it has not read the message yet.

## Who takes what you ask everyone

A request to everyone goes to the idle agent that fits it best, and every session works out the same winner from the same logs. No session coordinates the others, so if one exits the rest keep going.

Each session bids with its own side model, which reads its tasks, the files it touched and its decisions. The agent itself is never interrupted to bid, and a bid costs less than a cent. Busy sessions bid too, and cannot win while they are busy. A request then waits for the first one that finishes, instead of pulling anyone off their work.

The rule, in order: idle before busy, the highest fit, the fewest open tasks, the session that opened first. If the winner does not take the request within a few seconds, the next one in line does.

## When a message reaches the agent

| What                                        | Idle agent                                                 | Busy agent                        |
| ------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| Board changes                               | never sent                                                 | never sent                        |
| A colleague joins or leaves                 | next prompt                                                | next prompt                       |
| A room message without a mention            | not sent                                                   | not sent                          |
| A mention, or an answer to its question     | wakes it                                                   | after its run ends                |
| A colleague marks it urgent                 | wakes it                                                   | cuts in at the next safe point    |
| What you send with `/to`                    | wakes it                                                   | after its run ends                |
| A request to everyone that it won           | wakes it                                                   | waits for the next idle candidate |
| After 4 agent messages without you speaking | mentions stop waking anyone, and wait with the next prompt | same                              |

## What the others can and cannot do

A colleague's words are never yours. The judge that approves tool calls and the tasks keep reading only what you said, so no agent in the room can approve a push on your behalf. A colleague asking for work becomes a task marked as asked by that colleague, and the judge never reads those.

Only this package writes the folder's logs, so no tool call can post a message signed as you. The board shows who edited what and when, and the agent is told to ask a colleague before editing a file that colleague just touched.

## Commands

| Command                | Does                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `Alt+G`                | The board and the room                                        |
| `/room`                | The same panel                                                |
| `/all <message>`       | Ask everyone, and the best fit takes it                       |
| `/to <name> <message>` | Send it to one agent                                          |
| `/unsend`              | Take back your last message, if its agent has not read it yet |

## Settings

On the Peers tab of `Alt+S`, stored under `peers` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting | Default | Does                                                                                   |
| ------- | ------- | -------------------------------------------------------------------------------------- |
| Model   | `auto`  | The model that bids for this session. `auto` is the cheapest of the session's provider |

## License

MIT
