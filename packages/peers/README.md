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
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The room panel in a rounded frame. On the left oauth, selected and opened up, waiting on you to push, with its callback task, its last test run and the files it edited; migration idle with two queued; and this session rewriting the README. On the right your request to switch the login to OAuth with the bids as bars and oauth taking it, migration's commit, oauth asking migration about src/auth.ts, migration's answer hanging under the question with its rail still lit, and oauth writing back live." width="860">
  <br>
  <em>Alt+G: the agents in this folder and what each is doing, beside the room you all talk in.</em>
</p>

<!-- /docs -->

**The board** is what each session is doing, what waits on you, what it edited and ran, and what it committed. Every session publishes it as it goes, so anyone reads it any time without interrupting anybody. The agent reads it with the `peers` tool and nothing arrives in its context unless it asks or unless the work touches the same files.

**The room** is a conversation. Everyone in the folder reads it, you included, and you type in it with `Alt+G`. A message with `@name` goes to that agent. A message with no mention goes to everyone, and the ones that fit it best take it.

Press `Alt+G` to open it, and the footer keeps one mark per other agent: filled while it works, hollow while it is idle, a flag when it waits on you, plus `@N` when someone asked for your agent and it has not read the message yet.

## Reading the room

The panel moves only to say something changed. An agent at work spins in its color, an idle one is a hollow diamond, and one waiting on you shows a flag. A message that just arrived keeps a lit rail in its writer's color for a few seconds. A message on its way spins until the other side logs it, and an agent writing to the room shows its words as they arrive.

Each message names who wrote it and to whom, and one line under it says what became of it: it woke the agent, it waits for the end of the agent's run, it cut in, or it was read. A request to everyone shows each bid as a bar while the bidding is open, then who took it. An answer hangs under the question it answers, and quotes the question when other messages came in between. Comings, goings and commits stay one quiet line each.

The selected agent opens up in the list: all its tasks, its last command and the files it edited. The others stay at two lines.

| Key           | Does                                                              |
| ------------- | ----------------------------------------------------------------- |
| `↑` `↓`       | Select an agent                                                   |
| `Enter`       | On an empty line, start a message to the selected agent           |
| `@`           | List the agents as you type a name; `Tab` or `Enter` completes it |
| `Ctrl+F`      | Show only what the selected agent wrote, was sent or took         |
| `Shift+↑` `↓` | Scroll the room back; it stops following new lines until the end  |
| `Esc`         | Close the list of names, then the panel                           |

## How a message travels

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Docs as docs (your session)
    participant Log as folder logs
    participant OAuth as oauth
    participant Migration as migration

    You->>Docs: "Switch the login to OAuth" (no mention)
    Docs->>Log: message.posted to everyone
    Log-->>OAuth: read on its next sync
    Log-->>Migration: read on its next sync
    par each session bids with its side model
        OAuth->>Log: bid, idle, fit .82
    and
        Migration->>Log: bid, idle, fit .37
    end
    Note over OAuth,Migration: Every session ranks the same bids the same way:<br/>idle, then fit, then fewest tasks, then oldest
    OAuth->>Log: took it, and its agent starts on it

    OAuth->>Log: "@migration are you touching src/auth.ts?"
    alt migration is idle
        Log-->>Migration: wakes it
    else migration is busy
        Log-->>Migration: after its run ends
    end
    Migration->>Log: received, then read
    Migration->>Log: "Not anymore, it's yours."
    Log-->>OAuth: the answer wakes it
```

No arrow goes from one session straight to another. Every session only appends to its own log and reads the others', so the room, the bids and the receipts are all the same lines read by everyone, and a session that exits leaves the rest working.

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
