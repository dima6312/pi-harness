# Changelog

Every `@adeildo/` package in this repository shares one version, one tag and this changelog. The entries below 4.0.0 are from before, when `pi-ask-permission` was the only package.

## [5.10.0](https://github.com/felipeadeildo/pi-harness/compare/v5.9.2...v5.10.0) (2026-10-14)


### Features

* **ask-questions:** draw previews as written with a scroll bar, write questions live, and label picks, notes and your words ([bb9025b](https://github.com/felipeadeildo/pi-harness/commit/bb9025bde32f3d2970cd4960a22ddbd92903f9d9))
* **compact:** prune when a run ends with Anthropic's clearing off by default, and refuse calls that copy a pruned call ([e255e48](https://github.com/felipeadeildo/pi-harness/commit/e255e48bb871123408e6df99223e231fb9a7c76a))
* **docs:** the brand board at the top of the README, and the settings screen as a scene ([8ae71ca](https://github.com/felipeadeildo/pi-harness/commit/8ae71cad382883fd88f0394c49b59309c7738af9))
* frame pi's own entries, other agents' messages and the judge, drawing with named glyphs from the kit ([e8af129](https://github.com/felipeadeildo/pi-harness/commit/e8af1290fe092378f9fb1df065092b92b4e4401c))
* **kit:** one place merges the betas a request carries, keeping the payload when nothing was added ([384ed71](https://github.com/felipeadeildo/pi-harness/commit/384ed71806e647b357ea2affbb7712581d443b76))
* **kit:** one shape for a token count, a cost and the target of a call, decided once and used by the look ([228dfda](https://github.com/felipeadeildo/pi-harness/commit/228dfdaaecb682cbca82446f98495f6893e36117))
* **kit:** the scroll thumb, the time of day and the prune entry's name live in the kit, so nobody works them out twice ([604793b](https://github.com/felipeadeildo/pi-harness/commit/604793b123f3e1523c6d4a422934d9168d3366c1))
* **look:** a failed CI run and a waiting pull request on the start card ([eab51e4](https://github.com/felipeadeildo/pi-harness/commit/eab51e4f05a81ebd6c3d03c7d37de3e3bb3558c7))
* **look:** a start card with only what changed since your last session in the folder, and a π that rises ([d61a8b1](https://github.com/felipeadeildo/pi-harness/commit/d61a8b17291243b068f063a8730b423110eabc68))
* **look:** Alt+O opens a tool call's whole output to scroll, newest first, with the arrows moving between calls ([8b362bb](https://github.com/felipeadeildo/pi-harness/commit/8b362bbf42055be18dc288a203903d175cfb7857))
* **look:** close a running call's frame until its result draws, waiting for your answer on ask_questions ([8fd4260](https://github.com/felipeadeildo/pi-harness/commit/8fd426087caf1a9224f9e8cf4bc47026ff3fda78))
* **look:** fewer appearance settings with a live preview in Alt+S, and a pencil that inks in its own cell ([174c89c](https://github.com/felipeadeildo/pi-harness/commit/174c89c5701e16f532bd58f51a9816cc1324d3a3))
* **look:** frame your messages like the tool calls, named you, without pi's background and blank rows ([54c3f98](https://github.com/felipeadeildo/pi-harness/commit/54c3f98546c48e3e9e7f65f0741cee8cc60052c9))
* **look:** give ask_questions, peers, memory and the web tools their own marks ([beb4671](https://github.com/felipeadeildo/pi-harness/commit/beb467156356e7e1b6530eec5b79f587b1bb662a))
* **look:** queued messages in a dashed frame and a stretch that runs along a running call's rule ([b2905ee](https://github.com/felipeadeildo/pi-harness/commit/b2905ee3d4e825a70edc33ff1c1f8aff17cccd29))
* **look:** show the end of an edit or a write while the model writes it ([67def04](https://github.com/felipeadeildo/pi-harness/commit/67def04dd4dcd736f50f33f0c56deb1dd2271699))
* **look:** the strip says how the run went once it ends, and every number below the editor has its word ([ab312d5](https://github.com/felipeadeildo/pi-harness/commit/ab312d5ac36e625042967837d692dd6984c7fe34))
* one line for a written ask_questions call, and pi's cut-output note in the frame's words ([475ebab](https://github.com/felipeadeildo/pi-harness/commit/475ebabf2093539d0c721c7ce7e0af1a81ae534f))
* **peers:** [@everyone](https://github.com/everyone) tells every agent and [@anyone](https://github.com/anyone) asks for one, taken requests arrive together and in order ([f55e6a5](https://github.com/felipeadeildo/pi-harness/commit/f55e6a5010f07d68f3eba0aac8e7c16de26ed3ad))
* **peers:** deliver your messages at once and drop /unsend ([b841f16](https://github.com/felipeadeildo/pi-harness/commit/b841f16e78e6a6c2bfd5b6ca19161fd51abfb707))
* **peers:** send to [@name](https://github.com/name) and [@everyone](https://github.com/everyone) from the chat, replacing /to, /all and /room ([4db84f2](https://github.com/felipeadeildo/pi-harness/commit/4db84f21b076fae033b46e9cca7f182e3c6baad1))
* **peers:** the room draws messages and drafts in the transcript's frame ([69bc560](https://github.com/felipeadeildo/pi-harness/commit/69bc5600cebecab1a21f1a13bc2c012423b3b2f4))
* **providers:** keep the prompt cache warm between runs while you are likely to come back ([667ba34](https://github.com/felipeadeildo/pi-harness/commit/667ba3495b5bb40791cdfedd8feffac7c07f02b6))
* **providers:** list this session's cache misses with their cause and cost in the Providers tab ([2ca0b18](https://github.com/felipeadeildo/pi-harness/commit/2ca0b182c370d5e1bd64e866b522abdab9d391df))
* **providers:** pin the Claude Code version and let the settings pick the betas ([ce8549e](https://github.com/felipeadeildo/pi-harness/commit/ce8549e97f1b379904d0174dfe1ba9eb0f95f597))
* **providers:** read the beta notes out of the binary and show the pinned version read only ([f3ddccc](https://github.com/felipeadeildo/pi-harness/commit/f3ddcccd4ad2997e8dfb500885ff19ff38be5ee7))
* **scripts:** a typing bench that says where each keystroke's time goes ([9f6dced](https://github.com/felipeadeildo/pi-harness/commit/9f6dced8d0b3c4d9abcfe9629e26de713c081494))
* **scripts:** reverse engineer Claude Code on a cron and open a bump pull request ([88be6c4](https://github.com/felipeadeildo/pi-harness/commit/88be6c40be32622e8e63a34de7e1f5eee8cc15c2))


### Bug Fixes

* **docs:** draw the brand board from SVG groups, so the check needs no rsvg-convert ([7b59cb9](https://github.com/felipeadeildo/pi-harness/commit/7b59cb99544ce7a9e212512aff97458fbb603fe4))
* draw framed transcript entries once per change instead of on every keystroke ([ca82a60](https://github.com/felipeadeildo/pi-harness/commit/ca82a60fef5b7e89a431c6f56ffa6bd01bd1c239))
* keep the bench out of the room, and never announce a session that does nothing ([8ea3346](https://github.com/felipeadeildo/pi-harness/commit/8ea3346bc2c2e4e3ef0984601499f5961e2e701e))
* **look:** hand the GitHub answer to the header's listen call ([a607545](https://github.com/felipeadeildo/pi-harness/commit/a607545610b4cc36b2bd557598dfc845293b71fe))
* **look:** say the cache figure below the editor is the last prompt's, not the session's ([d24d0fb](https://github.com/felipeadeildo/pi-harness/commit/d24d0fb4e68fa082d3e701fd210ea866911446ad))
* **look:** the runner's output cap is the one git had, and readGit's runner is covered by a test ([9761f95](https://github.com/felipeadeildo/pi-harness/commit/9761f953b3fe5832e2f380c8748dfcc9c6ceb4e8))
* **peers:** a subagent stays out of the room, and a woke note carries its delivery ([4ba6407](https://github.com/felipeadeildo/pi-harness/commit/4ba6407a6c2c733ccd6a8e738ea16dea33143292))
* **peers:** turn the peers tool back on before a run when a reload left it off ([0b69bfc](https://github.com/felipeadeildo/pi-harness/commit/0b69bfc0e6c587fcef7b7908cd852502fed8abc5))
* **providers:** after you stop on an account at its limit, its next limits fail without asking again until it answers ([1babbaa](https://github.com/felipeadeildo/pi-harness/commit/1babbaa4673ad90da0309a39a55f69a146a05b3c))
* **providers:** read the feature gates from identifiers, and the binary only once ([8440136](https://github.com/felipeadeildo/pi-harness/commit/844013671ca7b165d7d8c3432791a5758684a668))
* **providers:** the web search beta says Vertex and Foundry once, and esc on the limit dialog is tested as stopping ([8e1259d](https://github.com/felipeadeildo/pi-harness/commit/8e1259de66af4df7ce158ebd3b36140fd57dd8cb))


### Performance Improvements

* **kit:** the screen keeps the lines it built, one group per section, and measures a frame row before cutting it ([ae0293f](https://github.com/felipeadeildo/pi-harness/commit/ae0293fb25639a1fba8895c049e4c1ee316745a9))
* **look,kit:** measure a line before cutting it, which is what the editor paid per keystroke (37 and 31 ms gone from a 2.2 s typing window) and the frames on every rule ([427d1b0](https://github.com/felipeadeildo/pi-harness/commit/427d1b0edeb265273482918d66aac16a11bf5ce9))
* **look:** keep the footer and the strip drawn for 100 ms, dropped by anything that asks for a redraw (footer 31/25 ms -&gt; 10 ms, busy window 550/584 -&gt; 468/486 ms) ([a37f3fb](https://github.com/felipeadeildo/pi-harness/commit/a37f3fb1a994e75e5ad6bb7f31d2b8f82518a322))
* **look:** resolve the glyph set once per setting change, not on every frame, rule and slot: 153 and 96 ms gone from a 2.2 s typing window (p50 10.2 ms) ([57ce92d](https://github.com/felipeadeildo/pi-harness/commit/57ce92df566997a6201e64427b8ce19d12ff3007))
* **look:** the Alt+O view wraps its lines once, one stat answers whether a write replaces a file, and the filler and the header measure before cutting ([94b8cfe](https://github.com/felipeadeildo/pi-harness/commit/94b8cfea37356153f867c59cc93489bed73199a3))
* **peers:** one pass over the peers per frame, and the group words from one place ([d5191be](https://github.com/felipeadeildo/pi-harness/commit/d5191be83ae866f0b9f93f85c5ce0a6a5f6fdba7))
* **providers:** learn the return chance line by line, and check the cached Claude Code binary without reading it ([f7d1fa8](https://github.com/felipeadeildo/pi-harness/commit/f7d1fa8496ce034133565b10b6623d96a3f7963f))
* redraw the start card, context use and finished entries only when they change; animate the marks of running, waiting and writing calls ([b8e20ba](https://github.com/felipeadeildo/pi-harness/commit/b8e20baa8078f142fcadcd2246c7d3d3600d873a))
* **scripts:** the newest-pi compare reads the registry once, and the release notes only when a body needs them ([7d3d1dd](https://github.com/felipeadeildo/pi-harness/commit/7d3d1dde418bfb7deeabe37120e8f33457c2701e))


### Reverts

* **docs:** drop the brand board, the session card stays as the one picture ([1679bbd](https://github.com/felipeadeildo/pi-harness/commit/1679bbda5f7c66cc560e858feb6e03988c124792))

## [5.9.2](https://github.com/felipeadeildo/pi-harness/compare/v5.9.1...v5.9.2) (2026-10-13)


### Bug Fixes

* **ask-questions:** draw pi's error when the tool throws instead of crashing ([7f9a8a3](https://github.com/felipeadeildo/pi-harness/commit/7f9a8a374fa506a077bcdc9051ec30c7f0316ebc))

## [5.9.1](https://github.com/felipeadeildo/pi-harness/compare/v5.9.0...v5.9.1) (2026-10-13)


### Bug Fixes

* **providers:** list every other account when one hits its limit ([e1e84a2](https://github.com/felipeadeildo/pi-harness/commit/e1e84a2d9163f20ca101931203456e9b233e3644))

## [5.9.0](https://github.com/felipeadeildo/pi-harness/compare/v5.8.0...v5.9.0) (2026-10-13)


### Features

* **kit:** log events per session ([fc09298](https://github.com/felipeadeildo/pi-harness/commit/fc092987dde5fdb571e82237f4d4e50ea01defad))
* **kit:** one frame for every dialog, with no backgrounds and the keys in its edge ([e5115ec](https://github.com/felipeadeildo/pi-harness/commit/e5115ec79637967e1726d5d7bab69f586c7e8db3))
* **kit:** stamp events with a given time ([bd7b6e3](https://github.com/felipeadeildo/pi-harness/commit/bd7b6e3d010a8324822bb8c90f7bf11dea29d132))
* **peers:** agents in one folder that talk and split work ([39f3802](https://github.com/felipeadeildo/pi-harness/commit/39f38029b7f34dff5f379b8cad8f7f3c281e847d))
* **peers:** show who is writing over the editor, and requests other agents took in the chat ([d9fae31](https://github.com/felipeadeildo/pi-harness/commit/d9fae31496b4456030bf4c9c800af13973512e18))
* **peers:** the Alt+G room and the footer marks ([a597e1b](https://github.com/felipeadeildo/pi-harness/commit/a597e1bbc4a2702c72daad9f697cfe676c97d182))
* **peers:** write in the room's own column, scroll it with the arrows, and label what each agent does ([96169b8](https://github.com/felipeadeildo/pi-harness/commit/96169b84ca040afa7d6bba5088bca5ea6b4185d2))
* **tasks:** give sessions a short name and log changes ([cda208b](https://github.com/felipeadeildo/pi-harness/commit/cda208bd06ae5fdf2005ece4083f8343c4cf1bba))


### Bug Fixes

* **kit:** drop whole keys from a narrow frame, keeping the way out ([6baddfe](https://github.com/felipeadeildo/pi-harness/commit/6baddfe21acc8c5330f6ed5d28389938c3ed482d))
* **peers:** always say how a user message queues ([a424736](https://github.com/felipeadeildo/pi-harness/commit/a424736bb48ff63cdb40d901d020aec01908d2cd))
* **peers:** attach a burst between calls, and let the setting decide how ([0b735fa](https://github.com/felipeadeildo/pi-harness/commit/0b735fa0b292d633946d70726bfbfbe6de1ab0c8))
* **peers:** draw each column to its own width ([de1554f](https://github.com/felipeadeildo/pi-harness/commit/de1554f782bbe0ac5bb201e9538b87d580d82134))
* **peers:** draw the room's clock in every timezone ([e95bc46](https://github.com/felipeadeildo/pi-harness/commit/e95bc4641d6ec78a4a2bf7b0ffa5150b9290bc53))
* **peers:** drop the rails and repeated quotes from the room, keeping a rail only on what just arrived ([5f54cee](https://github.com/felipeadeildo/pi-harness/commit/5f54cee0529ce09d33f4f3961a65be34ebaffc89))
* **peers:** let a read of the folder through, and keep peers off the footer's own colours ([f69e73b](https://github.com/felipeadeildo/pi-harness/commit/f69e73b6c15514de279e52e08c6331eceb748f94))
* **peers:** show only state, current task and edited files for each agent, wrapping the task ([bc6e22f](https://github.com/felipeadeildo/pi-harness/commit/bc6e22f2a8208781fe8b24c8667b6e28e24fa1b6))
* **peers:** wake an idle agent for any message, and stop only a chain of agents answering each other ([40b546c](https://github.com/felipeadeildo/pi-harness/commit/40b546c0c478926a9eb9f71d47776f15586556bc))

## [5.8.0](https://github.com/felipeadeildo/pi-harness/compare/v5.7.2...v5.8.0) (2026-10-12)


### Features

* **ask-questions:** show each answer under its question ([91a25d9](https://github.com/felipeadeildo/pi-harness/commit/91a25d994ff2ef3034e8cfa03ee4a39ac01d1370))
* **compact:** clear on Anthropic's side, keeping thinking ([84b9fde](https://github.com/felipeadeildo/pi-harness/commit/84b9fdef56e8ec6d08b79ecae46622a68c9669c2))
* **tasks:** keep the session title short and in English ([46dba76](https://github.com/felipeadeildo/pi-harness/commit/46dba762ef4b7a6984e09e017efac3f6bfcf0396))
* **tasks:** name the session after its title ([6d5b528](https://github.com/felipeadeildo/pi-harness/commit/6d5b5282f1cb19c2815162794b9d223d6aee9c90))


### Bug Fixes

* **ask-questions:** scroll previews in fullscreen pi ([ec52e52](https://github.com/felipeadeildo/pi-harness/commit/ec52e52110729cfafaacb571fa1b497c4c0ca7aa))
* **compact:** see the first clear after a reload ([c88c2a5](https://github.com/felipeadeildo/pi-harness/commit/c88c2a5b7f997df0462a2ffb4c9ad7904aa2b074))
* **tasks:** name a session titled before it opened ([b43f946](https://github.com/felipeadeildo/pi-harness/commit/b43f9466b45ef2e57cc2318f9bb6269528588a1c))
* **ui:** cut text with ... instead of an ellipsis ([a7c474b](https://github.com/felipeadeildo/pi-harness/commit/a7c474bee5e28cb59be3acbffe6f07997ad8d922))

## [5.7.2](https://github.com/felipeadeildo/pi-harness/compare/v5.7.1...v5.7.2) (2026-10-12)


### Bug Fixes

* **compact:** price the whole cache rewrite ([c9493c4](https://github.com/felipeadeildo/pi-harness/commit/c9493c468bb88dc6a08b9b9d6ffd39df94b1111a))

## [5.7.1](https://github.com/felipeadeildo/pi-harness/compare/v5.7.0...v5.7.1) (2026-10-12)


### Bug Fixes

* **compact:** let pi write the summary on the side model ([b290de0](https://github.com/felipeadeildo/pi-harness/commit/b290de0da6716b40a3d5a4650dcd11e48ae2442f))

## [5.7.0](https://github.com/felipeadeildo/pi-harness/compare/v5.6.0...v5.7.0) (2026-10-12)


### Features

* **compact:** hide old tool output in long sessions ([002079e](https://github.com/felipeadeildo/pi-harness/commit/002079efc3788de5c4066a808d80d54368933d39))
* **tasks:** change tasks with keys on Alt+T ([3a197d3](https://github.com/felipeadeildo/pi-harness/commit/3a197d3634db91728227968225b5280edd0b9182))


### Bug Fixes

* **compact:** align the prune line and show its cost ([ce401de](https://github.com/felipeadeildo/pi-harness/commit/ce401de5e6f71ca9c81343169372f69a3329a3eb))
* **tasks:** close what waited on you when you say you did what the agent just asked, and keep every field in your language ([29d7e46](https://github.com/felipeadeildo/pi-harness/commit/29d7e463fc52b5f0b74e0ef48345fb36300ca4f7))


### Dependencies

* bump the pi SDK to 1.1.0 ([25752cd](https://github.com/felipeadeildo/pi-harness/commit/25752cd13c6790ff9880f6a804e1212280151a53))

## [5.6.0](https://github.com/felipeadeildo/pi-harness/compare/v5.5.0...v5.6.0) (2026-10-12)


### Features

* **goal:** check every close against the session's words and measure the timeline against real cases ([4e89852](https://github.com/felipeadeildo/pi-harness/commit/4e89852d2b0ce46d604a13bbc4972ebe789eee34))
* **goal:** move a cursor through the Alt+G timeline on a solid panel, with the note of the item under it ([4cbf29c](https://github.com/felipeadeildo/pi-harness/commit/4cbf29cda702b65be33fb33a980e4053f2420ec0))
* **goal:** open the session's timeline as a tree on Alt+G, and keep the goal's counts beside a busy strip ([c6a2519](https://github.com/felipeadeildo/pi-harness/commit/c6a251997d031201b0b8058c23e602a1c4c50e88))
* **kit:** keep a session's tasks, with results, waits, decisions and the goal timeline read as tasks ([564f581](https://github.com/felipeadeildo/pi-harness/commit/564f58183c654d6349a6787309b5b377118defd2))
* **tasks:** replace the goal with tasks that keep what was done, what waits on you and what was decided ([fd52c94](https://github.com/felipeadeildo/pi-harness/commit/fd52c944457a151586fe12b24aec329d6ea1dc6c))


### Bug Fixes

* **goal:** close a step only when its run ends, never over a failed call or words that do not name it ([c32ba71](https://github.com/felipeadeildo/pi-harness/commit/c32ba71902dfe85d1f375141b617e110e201458a))
* **goal:** close nothing on a call alone, and mark the calls that failed or were refused ([206b29d](https://github.com/felipeadeildo/pi-harness/commit/206b29d7473e4a62413db48fe36bbaf277e6e78d))
* **goal:** close what repeats done work, read more of the conversation when tidying, and round the Alt+G panel's corners ([1566bf6](https://github.com/felipeadeildo/pi-harness/commit/1566bf690caf0e0778d0433d3f6e2715f4bd17e2))
* **goal:** give up a call that does not come back, so one stuck request cannot stop the timeline ([561e6ea](https://github.com/felipeadeildo/pi-harness/commit/561e6ea43ca0aede69e90c091849f4b6fa0d153e))
* **goal:** keep agent-rewritten words out of the intent, keep the counts on a short line, and wait for the goal through a plain event ([52c83b9](https://github.com/felipeadeildo/pi-harness/commit/52c83b974ce442c789d2d5659b0b81cbde91826c))
* **goal:** keep the Alt+G panel still, with one line per item and the selected one in full in a fixed pane ([4c0b191](https://github.com/felipeadeildo/pi-harness/commit/4c0b191ee7df6e94556e3eb456f92cb2d4a892ca))
* **goal:** keep what a finished step left in its note, not as a new item for later ([a56535d](https://github.com/felipeadeildo/pi-harness/commit/a56535d1e41ba022bd81d97a0b74fb1f9e24535b))
* **goal:** open one step per message, never close on words older than the item, and let you undo a done step that did not happen ([632cbcc](https://github.com/felipeadeildo/pi-harness/commit/632cbcc1c85a4d011722decc6db5b854ae11bd1b))
* **goal:** read your message when it enters the conversation, keep the goal on the current topic, and clear the lint warnings ([5609dae](https://github.com/felipeadeildo/pi-harness/commit/5609dae282835b7493c1a0d8162f760441f21f6a))
* **goal:** start a step at the message that asked for it, and read a named skill as the ask it is ([c6e993e](https://github.com/felipeadeildo/pi-harness/commit/c6e993e519c35a63eeb7afa9e11dc2fdc5acd308))
* **providers:** let requests that hit a limit together share one dialog, and open dialogs one at a time ([5f81cc1](https://github.com/felipeadeildo/pi-harness/commit/5f81cc1a8bd144366cc50a3881f3096a49398cda))
* **tasks:** open tasks only from your words, back every wait and decision with its line, and keep the end of a long message ([040496d](https://github.com/felipeadeildo/pi-harness/commit/040496d2c493f94d8ae97d5d4b068c91be1da82c))
* **tasks:** read your answers in the questions dialog as your words, in the same lines the agent reads ([26d7a2b](https://github.com/felipeadeildo/pi-harness/commit/26d7a2bbc64668b8cae2b10cb6d6b1492373de48))

## [5.5.0](https://github.com/felipeadeildo/pi-harness/compare/v5.4.0...v5.5.0) (2026-10-06)


### Features

* **goal:** keep the session's timeline (now, done, later) and give the judge your intent ([cef1fe1](https://github.com/felipeadeildo/pi-harness/commit/cef1fe1a16abf3e1f8228f52c0939d5ce738e355))
* **goal:** tidy from your words and the agent's work, and count what every goal call costs ([e12eec5](https://github.com/felipeadeildo/pi-harness/commit/e12eec5c1177b4b85a8f6c1e46642d40755ed48c))
* **goal:** title the timeline with the session's goal, and count what waits instead of showing its first line ([4daf43f](https://github.com/felipeadeildo/pi-harness/commit/4daf43f2b5411b665663f7f37485b22b89971ed7))


### Bug Fixes

* **ask-permission:** say on the ruling when the judge saw the session's goal ([4e79dcc](https://github.com/felipeadeildo/pi-harness/commit/4e79dccfff7e4467bacc8f810a7a562fabc8e4c9))

## [5.4.0](https://github.com/felipeadeildo/pi-harness/compare/v5.3.0...v5.4.0) (2026-10-06)


### Features

* **skills:** call several skills anywhere in a message, drawn as chips in the chat ([ff47dfe](https://github.com/felipeadeildo/pi-harness/commit/ff47dfe9af64c1771bd6c50b058d5ceb3745f7a5))

## [5.3.0](https://github.com/felipeadeildo/pi-harness/compare/v5.2.0...v5.3.0) (2026-10-06)


### Features

* **ask-questions:** wait until you stop typing before the model's questions open ([fbfdb10](https://github.com/felipeadeildo/pi-harness/commit/fbfdb1033e853e7c288a8101c9e35e4e2320af9f))
* **look:** carry the account next to the model and the plan's windows in the footer ([3e7d326](https://github.com/felipeadeildo/pi-harness/commit/3e7d326da6784e984170156b25a733ac0f07f6b5))
* **look:** frame the calls of tools that bring no renderers of their own ([dccb08b](https://github.com/felipeadeildo/pi-harness/commit/dccb08b201b9c9ea5669c3f81cbc35fa3c989e7f))
* **look:** say in the frame when the account needs a sign-in ([06eaa58](https://github.com/felipeadeildo/pi-harness/commit/06eaa5833ddc62db9747910d7b30b6cb5ee9cbd9))
* **providers:** keep each account's health and adopt the logins that arrive ([b3a1834](https://github.com/felipeadeildo/pi-harness/commit/b3a1834e7ac8e3eeaf6cd36afe8b6c285a9ae6f0))
* **providers:** keep the plan's quota from each response and count down its reset ([e318f79](https://github.com/felipeadeildo/pi-harness/commit/e318f79e94484a83cbbece737f0ef41c64597618))
* **providers:** move to another account when one is refused, and frame the dialogs ([f231bf2](https://github.com/felipeadeildo/pi-harness/commit/f231bf2441a5e237bc3b44d46dc60a4a44107989))
* **providers:** name every credential of a provider with accounts, and manage them in /accounts ([568944b](https://github.com/felipeadeildo/pi-harness/commit/568944b7cc04d3b36a63d6525c02740047637682))
* **providers:** read each account's plan and show it in the picker ([13d26d0](https://github.com/felipeadeildo/pi-harness/commit/13d26d0f3bec19a90fc2cd7d9358bc7107382978))
* **providers:** read the plan's quota from the endpoint and show it in the picker ([e99fdc7](https://github.com/felipeadeildo/pi-harness/commit/e99fdc755d94d11d9b0568d352eea826301fbbe8))
* **providers:** run a provider login on our own framed screen ([6cdde83](https://github.com/felipeadeildo/pi-harness/commit/6cdde83436adb92b26341f260c8c6a142c3a32b6))


### Bug Fixes

* **ask-permission:** ask about a codemode script's calls one at a time ([6f18955](https://github.com/felipeadeildo/pi-harness/commit/6f18955a0f7d289d145c1ba157ad95f748bfe3ad))
* **look:** keep a replayed call open for its result to close ([626eefe](https://github.com/felipeadeildo/pi-harness/commit/626eefeb95a5b24cb6d1fd842e87b0cbb28a12cb))
* **look:** leave the cost and the tokens out until the session spends some ([b023cb5](https://github.com/felipeadeildo/pi-harness/commit/b023cb5aa63a7fd016ba973e2f7e5ff1d3053561))
* **providers:** close the lock's own descriptor, not writeSync's count ([77f692b](https://github.com/felipeadeildo/pi-harness/commit/77f692bfae7d7b4b53af1ffd8a97037678fbabca))
* **providers:** read the plans of the provider a model switch lands on ([2476f16](https://github.com/felipeadeildo/pi-harness/commit/2476f1639e4ba7b3d75d85b8776c042da1902b05))
* **providers:** refresh an account under a lock two pi processes share ([c643481](https://github.com/felipeadeildo/pi-harness/commit/c64348178d2bbab4f484137db937424a4d95be5e))
* **providers:** refresh an expired account before reading its plan ([90316b9](https://github.com/felipeadeildo/pi-harness/commit/90316b9175d348e157641636872b3a708e700103))
* **providers:** show the sign-in URL itself and open the browser, like pi does ([ce2ea18](https://github.com/felipeadeildo/pi-harness/commit/ce2ea188efa2016f80987aab4dd4444a58a6f1c3))
* **providers:** stop /accounts from adopting the credential it adds ([6323d41](https://github.com/felipeadeildo/pi-harness/commit/6323d41f3380451a05b6cc696dc8ba32ff101ea6))

## [5.2.0](https://github.com/felipeadeildo/pi-harness/compare/v5.1.0...v5.2.0) (2026-10-03)


### Features

* **ask-permission:** answer yes instead of yes, run it ([093104f](https://github.com/felipeadeildo/pi-harness/commit/093104f727f52044606ec9a21967ca94d3cd421e))
* **ask-permission:** keep your answer on one line, and say when a call was blocked ([f08d370](https://github.com/felipeadeildo/pi-harness/commit/f08d3703d572d1ec5721b9eb12ef6b97d806f247))
* **ask-permission:** list every classifier pi knows in the judge model picker ([1745950](https://github.com/felipeadeildo/pi-harness/commit/17459507445e75cad2b91c6805499db1156be125))
* **ask-permission:** say on each call who decided and why, and judge parallel calls together ([fb9d716](https://github.com/felipeadeildo/pi-harness/commit/fb9d716c1e27805b6ceba1dfe53bdb6e6f5e3d58))
* **kit:** light the section under the cursor and keep it in view ([eb265c2](https://github.com/felipeadeildo/pi-harness/commit/eb265c22e97b3781082c03ca26b22e663817a331))
* **look:** count the pictures pi draws below a call, and drop the name from the license line ([cb8d086](https://github.com/felipeadeildo/pi-harness/commit/cb8d086986304246d76084c44a9ada9eb75b8d4d))
* **look:** frame every tool call, with the permission ruling on it ([ba330d0](https://github.com/felipeadeildo/pi-harness/commit/ba330d0ffa01700d338fa60ce4801a22112112ed))
* **look:** keep the time of a call on its frame, running or done ([d3e71dc](https://github.com/felipeadeildo/pi-harness/commit/d3e71dc9d17b14bea1c056a8ee19717e4b310e26))
* **look:** say what a tool call is, what it printed, and how it went ([9a569e6](https://github.com/felipeadeildo/pi-harness/commit/9a569e6550c2fcc65bfd113b59384408462060aa))
* **look:** say when a call is being written, waiting or running, and keep both times ([c7de912](https://github.com/felipeadeildo/pi-harness/commit/c7de9127067ecf3e97079be6084e2aca51698d1d))


### Bug Fixes

* **ask-permission:** drop the verdicts in flight when a branch opens ([dc87013](https://github.com/felipeadeildo/pi-harness/commit/dc87013698bcbbac233caad0519e79eef7a7be9a))
* **docs:** pin the colour depth so CI draws the same pictures ([2a685b5](https://github.com/felipeadeildo/pi-harness/commit/2a685b5463b8aa204eb47fc7f636cd0fc47f07e7))
* **kit:** line up a choice's descriptions and keep long labels whole ([cf8da04](https://github.com/felipeadeildo/pi-harness/commit/cf8da04236ebf8a0bd70d8185790e2c0390d2db7))
* **look:** draw a tool call again only when it changed, and guard the redraw with a test ([040e22f](https://github.com/felipeadeildo/pi-harness/commit/040e22f8fe074d9dc476ff42b9088af7e8377cd8))

## [5.1.0](https://github.com/felipeadeildo/pi-harness/compare/v5.0.0...v5.1.0) (2026-10-02)


### Features

* **ask-permission:** bring the questions dialog with the package and drop the classic one ([8546f71](https://github.com/felipeadeildo/pi-harness/commit/8546f71dc06fdc32e4ddc052ee012c27db727bdb))
* **ask-questions:** redesign the dialog with a fixed-size detail panel, inline notes and tabs that show what is answered ([8e83b4b](https://github.com/felipeadeildo/pi-harness/commit/8e83b4b0ffb1870cb46739e8ec3eba442c067b38))
* **ask-questions:** write notes in the panel, fill the width, and let a question leave out the typed row ([0569f67](https://github.com/felipeadeildo/pi-harness/commit/0569f67febc328af03f1a4113744ff5d3d7d4771))


### Bug Fixes

* **ask-permission:** put the command right under what wants to run ([e226554](https://github.com/felipeadeildo/pi-harness/commit/e2265541b825ae826c5a3dbb0dfeada6e98ac05c))
* **ask-permission:** show the first 3 lines of a long command and how many are left ([3bd672c](https://github.com/felipeadeildo/pi-harness/commit/3bd672c7a5a6a7cc6b5006270405759790bfeb57))
* **ask-questions:** show a note once, in the panel, and mark its option with an arrow ([69b51a7](https://github.com/felipeadeildo/pi-harness/commit/69b51a71345cd1d55a0eeb98795f06e6d248ef0c))
* **ask-questions:** size the panel for notes, name the row only when its label is cut, and drop the spare blank lines ([9f71fa0](https://github.com/felipeadeildo/pi-harness/commit/9f71fa0b3c7e860c7d09620ac7b8bd83346ca034))

## [5.0.0](https://github.com/felipeadeildo/pi-harness/compare/v4.1.0...v5.0.0) (2026-10-01)

Every piece lives on one settings screen now, and a new package joins the set: the model asks with options instead of guessing.

This release needs **pi 0.99.2**, which is what MCP and the tool annotations come from.

### ⚠ BREAKING CHANGES

* **ask-permission:** the judge is set with a model, a policy and a rigor, and it reads your last message as the intent behind the call. `judge.provider`, `judge.enabled` and `judge.tools` are gone, and the retired keys are removed from the settings file on the next session, with a notice ([87014f3](https://github.com/felipeadeildo/pi-harness/commit/87014f3623604d8ed496b8e0a0645b05a1ed188f))
* **every piece:** one settings screen on `Alt+S`, a tab per piece, in place of `/perm` and `/look` ([9cc50c0](https://github.com/felipeadeildo/pi-harness/commit/9cc50c05650c900265d08d00e151f9053c21b34a))
* **ask-permission:** four modes, manual, edits, judge and full, with `Alt+W` for calls outside the workspace ([3f0348a](https://github.com/felipeadeildo/pi-harness/commit/3f0348ab164f758ff470758dfc69b30daf0dc753))

### Features

* **ask-questions:** a new package, `@adeildo/pi-ask-questions`, with the `ask_questions` tool. Every question comes with options, a preview of the option under the cursor, a note on any option whether it was picked or not, and a row for your own answer. The dialog is drawn in the flow of the screen instead of over the chat, so a tall one scrolls with the terminal ([95fc137](https://github.com/felipeadeildo/pi-harness/commit/95fc137404b348bb8f1c1774a4e7dda75f70c980))
* **ask-permission, ask-questions:** one dialog for both. The permission ask goes through the questions package, with the call, the reason and the diff riding in the question. `always yes` then asks which calls to remember and for how long, and an answer typed in your own words blocks the call, with the text as the reason the model reads ([0ebcec2](https://github.com/felipeadeildo/pi-harness/commit/0ebcec283b409f7771505098803003d6353150c2))
* **ask-permission:** a call to an MCP server follows the policy of its server, set on the Permission tab, and a call a codemode script made is decided on its own, instead of asking twice for one thing ([08e3810](https://github.com/felipeadeildo/pi-harness/commit/08e38104297e274e05fa355155c532904d07af4b))
* **ask-permission:** a call that leaves the workspace offers to open that folder, for reads or as part of the workspace ([09cc796](https://github.com/felipeadeildo/pi-harness/commit/09cc79648768d888e1230d35f0fd5cca9e05dcd0))
* **providers:** several accounts per provider. The pi login becomes the first account, another comes from the provider's own login, the active one is a session entry so a resume restores who paid, and `Alt+A` cycles them ([09049cf](https://github.com/felipeadeildo/pi-harness/commit/09049cfbe32c656c468c926ffc770360b684308d), [2e8ef4b](https://github.com/felipeadeildo/pi-harness/commit/2e8ef4b0497896ed6228cd48515f5523bad4f29e))
* **providers:** an account that hits its limit hands over to the next one, asking first by default ([5adbfb0](https://github.com/felipeadeildo/pi-harness/commit/5adbfb0a020d37d5a8a2b4c33509fb2f50a6f897))
* **look:** the account sits next to the model, and the working line names the state in lower case instead of repeating the call being drafted ([4ef6328](https://github.com/felipeadeildo/pi-harness/commit/4ef632884a9c47681dfb30d4af9813909d5dc138), [f689c2d](https://github.com/felipeadeildo/pi-harness/commit/f689c2d87be7701dd92aa8b379c6b98b8d23f6f8))
* **look:** the wait is timed from the moment the request leaves the machine, and the token speed uses the ratio the session measured, in place of a flat four characters per token ([29e74b4](https://github.com/felipeadeildo/pi-harness/commit/29e74b471cd9ee6dd72a62ac99ec163f7ba96957))
* **every piece:** the middle dots are gone from the dialogs, the hints and the status lines, and the footer separator defaults to a space ([a3814b4](https://github.com/felipeadeildo/pi-harness/commit/a3814b4cbd177579a46fbb548c8274ff59ce3096))

### Dependencies

* the pi SDK is bumped to 0.99.2, which this release needs ([b600128](https://github.com/felipeadeildo/pi-harness/commit/b600128))

### Bug Fixes

* **ask-permission:** read a bash command that sets a shell variable before it reads it, and then trust that variable only where bash surely set it and nothing else can change it afterwards ([cd7da40](https://github.com/felipeadeildo/pi-harness/commit/cd7da405f5da4dfcbbc053013148b5a3c262a09a), [0387aa9](https://github.com/felipeadeildo/pi-harness/commit/0387aa9eab80cefc9dc5ceadd290aebbb7fbfe7c))
* **ask-permission:** show what an MCP server declares in the dialog, and keep the registered tool name in `alwaysAsk` ([b4cec5f](https://github.com/felipeadeildo/pi-harness/commit/b4cec5f53a65f11095293c9f6349400d15d9d5fb))
* **providers:** keep a refreshed token on the account it came from, lift a provider when its first account arrives rather than only at session start, and stop caching the native methods ([1e04718](https://github.com/felipeadeildo/pi-harness/commit/1e0471869ae515222fbc27ec557d998a8d43e5ca), [1068ef4](https://github.com/felipeadeildo/pi-harness/commit/1068ef48378a21fd2693afd2a1345e42a9dac17c), [4254a3d](https://github.com/felipeadeildo/pi-harness/commit/4254a3d6d677c541c5351b2600ceafeab9925a54))
* **kit:** a feature that reads or writes a setting it never declared now throws, instead of reading a default forever ([e8a9bc8](https://github.com/felipeadeildo/pi-harness/commit/e8a9bc81ccabd26c97ab0c00199926259668f766))

## [4.1.0](https://github.com/felipeadeildo/pi-harness/compare/v4.0.0...v4.1.0) (2026-09-30)

### Features

* **harness:** `@adeildo/pi-harness` brings every piece: the permission dialog, the look and providers, one extension each, so `pi config` turns any of them off ([693b946](https://github.com/felipeadeildo/pi-harness/commit/693b9464149de87e375054f505891ee82ec8a8a1))
* **look, providers:** each piece is also a package of its own, `@adeildo/pi-look` and `@adeildo/pi-providers`, for whoever wants only that one. With a piece installed both ways, the first copy runs and the other stays off ([693b946](https://github.com/felipeadeildo/pi-harness/commit/693b9464149de87e375054f505891ee82ec8a8a1))

### Bug Fixes

* **release:** hand the terminal to npm so publish and trust can ask for 2FA ([45f0d3e](https://github.com/felipeadeildo/pi-harness/commit/45f0d3ef7881e1d3444dc57c0a70ea2c844dc98d))

## 4.0.0 (2026-09-30)

### ⚠ BREAKING CHANGES

* **ask-permission:** publish as `@adeildo/pi-ask-permission`. `pi-ask-permission` stays on npm at 3.0.0, deprecated. The config, the grants and the old sessions keep working ([dac6462](https://github.com/felipeadeildo/pi-harness/commit/dac646269680dbd7af76c7fd174b6d49ef7e7c19))
* **ask-permission:** read the config from the shared settings file ([0e9de2b](https://github.com/felipeadeildo/pi-harness/commit/0e9de2b4b779b010c1cfea07d0d736bf4ccd07b8))
* **look:** drop the prompt glyph in front of the editor, and the `look.frame.prompt` setting with it ([53fcfff](https://github.com/felipeadeildo/pi-harness/commit/53fcfff7758b7a1876ac2beb292949231922e926))

### Features

* **harness:** first release of `@adeildo/pi-harness`, with the look and providers as one extension each, so `pi config` turns either off ([64b24b2](https://github.com/felipeadeildo/pi-harness/commit/64b24b272d3e9b17e041dba070f6a935c3d16f79))
* **look:** replace the statusline with the whole look, from the start card to a framed editor ([f603bd2](https://github.com/felipeadeildo/pi-harness/commit/f603bd2010e7ea969b6bb341a2d63dc22e95c532))
* **look:** show the answer being written, its cost per million and the session speed ([71994d0](https://github.com/felipeadeildo/pi-harness/commit/71994d054f9b5dbe47114fed662488e6d295965c))
* **look:** give every effort level its own bar, paint the data and give every piece its own glyph ([b259aad](https://github.com/felipeadeildo/pi-harness/commit/b259aad8607f4f7941c9e3e85fb40338690ac25e))
* **look:** draw the git distance and the icons, and drop a zero cost ([8280954](https://github.com/felipeadeildo/pi-harness/commit/828095499d92a0af50b3fca451eaa75d9f6bb8de))
* **look:** show which pi version drew the line ([ad44468](https://github.com/felipeadeildo/pi-harness/commit/ad44468da2937bf4652a2bb05e0bc2af225306f5))
* **providers:** bill Anthropic OAuth requests to the Claude plan ([1a26543](https://github.com/felipeadeildo/pi-harness/commit/1a265438427054268429771156f3d83363d6d785))
* **kit:** add the app builder, settings and events that features are built on ([b5be12e](https://github.com/felipeadeildo/pi-harness/commit/b5be12e5145fcd7c99677bc83247675bbf359903))
* **kit:** give each feature its own scope, an on/off switch and project settings ([cb4eda4](https://github.com/felipeadeildo/pi-harness/commit/cb4eda4aaed4877bf66a4a364d357bddd3abe939))
* publish the workspace packages in dependency order, with a smoke test ([98f72d9](https://github.com/felipeadeildo/pi-harness/commit/98f72d97a313b8f6182e297e5b2444af0292038d))

### Bug Fixes

* **release:** refresh bun.lock on the release PR and refuse a stale workspace version ([e5656aa](https://github.com/felipeadeildo/pi-harness/commit/e5656aadcbce1e76a13c3b80429ab8dbe93151ca))

### Build

* the pi SDK is 0.99.1 ([33007a3](https://github.com/felipeadeildo/pi-harness/commit/33007a3b690e50bdeca3132d912105b4fb0d7f25))

## [3.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.1...v3.0.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **commands:** suggest /perm arguments and rename reset to forget
* **config:** name each config key after its /perm row
* **workspace:** gate auto-approvals by project scope

### Features

* **commands:** suggest /perm arguments and rename reset to forget ([2cc932e](https://github.com/felipeadeildo/pi-ask-permission/commit/2cc932eef7a6e48adb775fec444be8d8782b4c6c))
* **config:** name each config key after its /perm row ([a9a2738](https://github.com/felipeadeildo/pi-ask-permission/commit/a9a273824e3d83b5a1903cf8c548df995f672e8f))
* **dialog:** show the diff an edit or write would make ([1222ca9](https://github.com/felipeadeildo/pi-ask-permission/commit/1222ca9dd3aa4bc30d53991de6cf79caced7e4d6))
* **events:** announce each decision and let other tools describe what they touch ([8dad96d](https://github.com/felipeadeildo/pi-ask-permission/commit/8dad96dc21fdad6f4b557743eceeb940d899add2))
* **readonly:** accept for loops and newline-separated commands ([8ce81bf](https://github.com/felipeadeildo/pi-ask-permission/commit/8ce81bf1d9f1c6da3b86cc0fe4240d08eeda70c0))
* **session:** keep the mode and this session's always yes across reloads and resumes ([264e815](https://github.com/felipeadeildo/pi-ask-permission/commit/264e815adf597cefd0c84b28e3f7e0eb07b0c12d))
* **workspace:** gate auto-approvals by project scope ([cfb7739](https://github.com/felipeadeildo/pi-ask-permission/commit/cfb773977b29950964a8be058963522f94dfcc3b))


### Bug Fixes

* **always-yes:** add to the saved file instead of overwriting it, now always-yes.json ([ede87d4](https://github.com/felipeadeildo/pi-ask-permission/commit/ede87d428810125cdf49bcf45f62ed2bbff88f85))
* **bash:** keep pi's shell settings in the timed bash override ([8bb8d2b](https://github.com/felipeadeildo/pi-ask-permission/commit/8bb8d2be0a04b88123b9fb409b168c746abc5e43))
* **config:** load config.json when a session starts, not when pi loads the extension ([79ddf75](https://github.com/felipeadeildo/pi-ask-permission/commit/79ddf75f4681318c2a6b4eb2fd2bfbdb9ea4c62f))
* **config:** replace the rename warnings with one info line ([dcbfdee](https://github.com/felipeadeildo/pi-ask-permission/commit/dcbfdeef5a0ca87ae59f219c71ada9d6cd979c78))
* **dialog:** put the title's space after the title, not before the corner ([1dce5a0](https://github.com/felipeadeildo/pi-ask-permission/commit/1dce5a084859a66b8b4b460f17e0e162f11d1b41))
* **workspace:** count powershell as outside and decide calls through tool adapters ([1216555](https://github.com/felipeadeildo/pi-ask-permission/commit/12165558c53d6834e1da09212484a97481119028))

## [2.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.0...v2.0.1) (2026-09-21)


### Bug Fixes

* **readonly:** allow git branch and git remote listings ([0681ea4](https://github.com/felipeadeildo/pi-ask-permission/commit/0681ea4670f95d3547e17e4805bdf6561340e8bb))

## [2.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.2.0...v2.0.0) (2026-09-21)


### ⚠ BREAKING CHANGES

* `yolo` is removed from config.json. Set `mode` to "manual", "accept-edits", or "yolo" instead.

### Features

* replace the persisted yolo flag with session modes ([3380e6c](https://github.com/felipeadeildo/pi-ask-permission/commit/3380e6ce760ef672c66621fecde2744b77a8aadd))


### Bug Fixes

* **readonly:** accept benign redirects, sed address ranges, and quoted substitutions ([fe4bb1e](https://github.com/felipeadeildo/pi-ask-permission/commit/fe4bb1e1cbb47200a71770ec5434c0430f76007d))

## [1.2.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.1.0...v1.2.0) (2026-09-20)


### Features

* default AI approvals to a policy preset and show why the judge asked ([7843c43](https://github.com/felipeadeildo/pi-ask-permission/commit/7843c4351cb8cd600199e81db0d846c2cd078439))
* delegate approvals to a judge model ([51bb31b](https://github.com/felipeadeildo/pi-ask-permission/commit/51bb31b3d1c120d3a8d52ada32c17adbb248681f))
* show a card for every judge decision ([a429e71](https://github.com/felipeadeildo/pi-ask-permission/commit/a429e71fc203ba74a4a1c5287ffa99731093b84a))
* warn when AI approvals are on without a policy ([48dc772](https://github.com/felipeadeildo/pi-ask-permission/commit/48dc7727f8c6622b7f796079a53ec260644b7be6))


### Bug Fixes

* render judge entries persisted before per-turn grouping ([f0255d9](https://github.com/felipeadeildo/pi-ask-permission/commit/f0255d9f5c05b94df2c9e00b335de3d75919d688))
* show a judge card as soon as the judge decides ([cc84f6f](https://github.com/felipeadeildo/pi-ask-permission/commit/cc84f6f08fbe2c4f02cec044fd41c2a01cf467cd))
* size the judge card columns to the card itself ([a2a57a1](https://github.com/felipeadeildo/pi-ask-permission/commit/a2a57a11160154721136550ec4ca7b4ca0e91616))
* surface judge decisions and stop reporting rate limits as timeouts ([eb1f511](https://github.com/felipeadeildo/pi-ask-permission/commit/eb1f51194b93883f8fb21e32e23daff8c97960d4))

## [1.1.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.1...v1.1.0) (2026-09-20)


### Features

* auto-allow read-only bash commands ([21c36a8](https://github.com/felipeadeildo/pi-ask-permission/commit/21c36a838196254d4dbf65be73bc2a791c04bff9))

## [1.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.0...v1.0.1) (2026-09-20)


### Bug Fixes

* skip the generated changelog and allow a manual publish ([31f5478](https://github.com/felipeadeildo/pi-ask-permission/commit/31f5478868fd52130e19f01bbf4bbda58b14c7d7))

## 1.0.0 (2026-09-20)


### Features

* add pi-ask-permission, a three-way permission dialog with note followups ([55b603b](https://github.com/felipeadeildo/pi-ask-permission/commit/55b603b0e5c7ef049d4b614e7d3b6d89b9fcc12e))
* block an edit that cannot apply before the permission dialog ([5faaade](https://github.com/felipeadeildo/pi-ask-permission/commit/5faaadeaaad359a90dd4dede499e5536aeb2bafc))
* hold the dialog while the user is typing ([52fcfea](https://github.com/felipeadeildo/pi-ask-permission/commit/52fcfea4764e5d1042186d2c694516a8d7c683f2))
* keep a per-row note draft while arrowing the permission dialog ([84d684f](https://github.com/felipeadeildo/pi-ask-permission/commit/84d684ffdc246cd3f10a2fee68cfbfa12d75998f))
* paste images and long text into the permission note ([9dbc842](https://github.com/felipeadeildo/pi-ask-permission/commit/9dbc842110b70f13176e14c2e18ebbf2358548a8))
* scope always-yes grants to the session, the project, or everywhere ([d8aa4d2](https://github.com/felipeadeildo/pi-ask-permission/commit/d8aa4d23e12ec731d8f2102a1dffcd5fb2603147))


### Bug Fixes

* stop counting approval time in the bash Took line ([8e1a30c](https://github.com/felipeadeildo/pi-ask-permission/commit/8e1a30cfba7b9fea6ea5537ef24dd956c698e419))


### Miscellaneous Chores

* point the npm homepage at the pi gallery ([17e49bc](https://github.com/felipeadeildo/pi-ask-permission/commit/17e49bcfc02fb3737e65a2a0b7b534f4a66978c5))
