<h1 align="center">@adeildo/pi-skills</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-skills"><img src="https://img.shields.io/npm/v/@adeildo/pi-skills" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Call your skills from anywhere in a message, several at once.</strong><br>
  The model reads each one in full. The chat shows a small chip where you typed it.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-skills</code></p>

## What changes

This piece brings no skills of its own. It changes how you call the ones pi already loaded, from your skill folders or from packages.

Pi expands `/skill:name` only at the start of a message, and only one. With this piece, any `/skill:name` in the text counts:

```text
use /skill:simplify, then go over the docs with /skill:unslop
```

Before the message, the model gets one block per skill, the same `<skill>` block pi writes for `/skill:name`. Your text reaches it as you typed it. In the chat, each reference shows as `[skill] name` on a violet background, the way pi labels a folded skill. The blocks stay folded until `Ctrl+O`, which expands tool output, shows them in full.

A reference counts when it names a skill pi loaded and follows a space, the start of a line or an opening bracket. Inside backticks it stays text.

## Typing a reference

A `/` past the start of the message opens a list of the skills alone, narrowed as you type, the way pi's palette does at the start. Picking one writes `/skill:name` and a space. The list opens on `/` in the editor of [`@adeildo/pi-look`](../look), which also colors each reference while you type. In any other editor, `Tab` after the `/` opens it.

At the start of the message, `/` still opens pi's own palette, with the commands and the skills.

## Notes

- A message that starts with `/skill:` goes out with a space before it, so pi does not expand that skill a second time. The chat does not draw the space.
- While the model works, the skills queue with the message, as a steer or a follow-up.
- If a skill file cannot be read, the message goes without that skill and a warning says why.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
