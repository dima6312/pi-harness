<h1 align="center">@adeildo/pi-peers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-peers"><img src="https://img.shields.io/npm/v/@adeildo/pi-peers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Agents in one folder, aware of each other.</strong><br>
  The board, the room, and the auction for what you ask everyone.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-peers</code></p>

Start pi in another terminal in the same folder and it appears here. There is no broker, no daemon and no
server: each session writes its own log in `~/.pi/agent/harness/events/<folder>/` and reads the others'. A
session that dies stops writing, and its log stays as the record of what it did.

## The board and the room

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The room panel in a rounded frame, in two columns. On the left the agents: oauth selected, waiting on you to push, on the OAuth callback, with the files it edited; migration idle; this session last, rewriting the README. On the right the room: your request to switch the login to OAuth with the bids as bars and oauth taking it, migration's commit, oauth asking migration about src/auth.ts with woke it at the end of the line, migration's answer hanging under the question with its rail still lit, oauth writing back live, and under it all the line you write in." width="860">
  <br>
  <em>Alt+G: the agents in this folder and what each is doing, beside the room you all talk in and write to.</em>
</p>

<!-- /docs -->

**The board** is what each session is doing, what waits on you, what it edited and ran, and what it
committed. Each session publishes it as it goes, so anyone reads it without interrupting anybody. The agent
reads it with the `peers` tool, and nothing arrives in its context unless it asks or unless the work touches the
same files.

**The room** is a conversation. Everyone in the folder reads it, you included, and you type in it with `Alt+G`.
A message with `@name` goes to that agent. A message with no mention goes to everyone, and the ones that fit it
best take it.

The room reaches you without being opened. A line over the editor names who writes to whom as the words
arrive, and a request to everyone that another agent took shows in your chat with who took it, for you to read
only: your agent never gets it, so two of them do not start the same work. The footer keeps one mark per other
agent, filled while it works, hollow while it is idle, a flag when it waits on you, and `@N` for what your agent
has not read yet.

## Reading the room

In the panel, the message that just arrived keeps a lit rail in its writer's color for a few seconds, a message
still on its way spins until the other side logs it, and an agent writing shows its words as they arrive.

Each message starts with a line naming who wrote it, to whom and when. The right end of that line says what
became of it: it woke the agent, it waits for the end of the agent's run, it cut in, or it was read. A long
message shows its first lines, and the newest one shows in full. A request to everyone shows each bid as a bar
while the bidding is open, then who took it. Comings, goings, restarts and commits stay one quiet line each.

| Key           | In the room                                                       | In the agents               |
| ------------- | ----------------------------------------------------------------- | --------------------------- |
| `↑` `↓`       | Scroll the room; it stops following new lines until the end       | Select an agent             |
| `PgUp` `PgDn` | Scroll a page                                                     | Scroll the room a page      |
| `Enter`       | Send to everyone, or to the agents you `@` mention                | Write to the selected agent |
| `@`           | List the agents as you type a name; `Tab` or `Enter` completes it |                             |
| `Tab`         | Go to the agents                                                  | Back to the room            |
| `Ctrl+F`      | Show only what the selected agent wrote, was sent or took         | Same                        |
| `Esc`         | Close the list of names, then the panel                           | Back to the room            |
| `Alt+G`       | Close the panel, back to the chat                                 | Same                        |

Typing while the agents column has the keys writes in the room, so you never have to go back first.

## How a message travels

```mermaid
sequenceDiagram
    autonumber
    actor You
    box rgb(38,48,62) the folder
      participant Log as folder logs
    end
    box rgb(48,42,62) the sessions
      participant Docs as docs (your session)
      participant OAuth as oauth
      participant Migration as migration
    end

    rect rgb(40,58,48)
      Note over You,Log: your message reaches everyone
      You->>Docs: "Switch the login to OAuth" (no mention)
      Docs->>Log: message.posted, to everyone
      par each session reads it on its next sync
        Log-->>OAuth: message.posted
      and
        Log-->>Migration: message.posted
      end
    end

    rect rgb(58,52,36)
      Note over OAuth,Migration: each bids with its own side model
      OAuth->>Log: bid, idle, fit .82
      Migration->>Log: bid, idle, fit .37
      OAuth->>Log: took it, and its agent starts on it
    end

    rect rgb(52,40,44)
      Note over OAuth,Migration: a question, and the answer that wakes
      OAuth->>Log: "@migration are you touching src/auth.ts?"
      alt migration is idle
        Log-->>Migration: wakes it
      else migration is busy
        Log-->>Migration: after its run ends
      end
      Migration->>Log: received, then read
      Migration->>Log: "Not anymore, it's yours."
      Log-->>OAuth: the answer wakes it
    end
```

No arrow goes from one session straight to another. Every session only appends to its own log and reads the
others', so the room, the bids and the receipts are the same lines read by everyone, and a session that exits
leaves the rest working.

## Who takes what you ask everyone

A request to everyone goes to the idle agent that fits it best, and every session works out the same winner
from the same logs. No session coordinates the others, so if one exits the rest keep going.

Each session bids with its own side model, which reads its tasks, the files it touched and its decisions. The
agent itself is never interrupted to bid, and a bid costs less than a cent. Busy sessions bid too, and cannot
win while they are busy, so a request waits for the first one that finishes instead of pulling anyone off their
work.

The rule, in order: idle before busy, the highest fit, the fewest open tasks, the session that opened first. If
the winner does not take the request within a few seconds, the next one in line does.

## When a message reaches the agent

Everything waiting when the agent looks arrives together, so a burst of messages is one turn for the
agent to read, not one turn per message. A message attaches at the end of the call the agent is running
now, the way your own steer does, so nothing it was doing is thrown away. The setting below changes that
for colleagues' messages.

| What                                              | Idle agent                              | Busy agent                        |
| ------------------------------------------------- | --------------------------------------- | --------------------------------- |
| Board changes                                     | never sent                              | never sent                        |
| A colleague joins or leaves                       | next prompt                             | next prompt                       |
| A room message without a mention                  | not sent                                | not sent                          |
| A mention, or an answer to its question           | wakes it                                | attaches between calls            |
| A colleague marks it urgent                       | wakes it                                | attaches between calls            |
| What you send with `/to`                          | wakes it                                | attaches between calls            |
| A request to everyone that it won                 | wakes it                                | waits for the next idle candidate |
| A request to everyone another agent took          | shown in your chat, not sent            | same                              |
| An agent answering the one that woke it, 4th time | stops waking, waits for the next prompt | same                              |

## What the others can and cannot do

A colleague's words are never yours. The judge that approves tool calls and the tasks keep reading only what
you said, so no agent in the room can approve a push on your behalf. A colleague asking for work becomes a task
marked as asked by that colleague, and the judge never reads those.

Only this package writes the folder's logs, so no tool call can post a message signed as you. Reading them
stays allowed, and the agent is told to ask a colleague before editing a file that colleague just touched.

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

| Setting       | Default       | Does                                                                                                                                                                                                  |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| While it runs | between calls | How a colleague's message reaches your agent while its run is going: between calls (the default), after the run ends, or with your next prompt. A message marked urgent always attaches between calls |
| Model         | `auto`        | The model that bids for this session. `auto` is the cheapest of the session's provider                                                                                                                |

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
