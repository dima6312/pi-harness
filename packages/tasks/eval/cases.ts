// Cases cut from real sessions, each with what the tasks should look like after the call. Most
// come from a call the goal timeline got wrong; the rest keep a fix from breaking what worked.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	emptyTasks,
	type SessionTasks,
	type Task,
	type TaskStatus,
	type WaitingOn,
} from "@adeildo/pi-kit";

import type { Line, LineKind } from "../src/transcript.ts";

export interface Expect {
	status?: Record<string, TaskStatus>;
	/** Each task ends open: not done, not dropped. */
	open?: string[];
	/** Each task ends done or still under way, not waiting or untouched. */
	worked?: string[];
	waitingOn?: Record<string, WaitingOn>;
	/** How many tasks are added, at least and at most. */
	added?: [min: number, max: number];
	/** Some task, result, left or decision says this. */
	mentions?: RegExp[];
	/** How many decisions are added, at least. */
	decided?: number;
	decidedAtMost?: number;
	title?: "set" | "kept";
	result?: Record<string, RegExp>;
	/** Words that show the title or a task was written in a language you did not write in. */
	wrongLanguage?: RegExp;
	/** No task says this. */
	none?: RegExp;
	/** How many open tasks say this. */
	openMatching?: [pattern: RegExp, count: number];
}

export type Request =
	| { moment: "message"; state: SessionTasks; message: string; reply?: string; busy?: boolean }
	| { moment: "run"; state: SessionTasks; run: string }
	| { moment: "tidy"; state: SessionTasks };

export interface Case {
	name: string;
	/** What went wrong, or what must keep working. */
	why: string;
	request: Request;
	expect: Expect;
}

type Row = [id: string, status: TaskStatus, text: string, extra?: Partial<Task>];

function tasks(title: string | undefined, rows: Row[], language = "Portuguese"): SessionTasks {
	const list = rows.map(([id, status, text, extra]): Task => ({
		id,
		status,
		text,
		origin: "you",
		created: { at: 0 },
		asks: [],
		updatedAt: 0,
		...extra,
	}));
	return {
		...emptyTasks(),
		tasks: list,
		nextTask: list.length + 1,
		language,
		...(title === undefined ? {} : { title, titleOrigin: "you" as const }),
	};
}

function fixture(name: string): string {
	return readFileSync(join(import.meta.dir, "runs", `${name}.txt`), "utf8").trim();
}

/** A run as the model reads it, back into lines the checks can find refs in. */
export function linesOf(run: string): Line[] {
	return run.split("\n").flatMap((row): Line[] => {
		const match = /^(L\d+) (you|said|report|call): (.*)$/.exec(row);
		if (match === null) return [];
		const [, ref = "", kind = "said", text = ""] = match;
		const failed = text.endsWith("(failed or refused: it did not happen)");
		return [{ ref, kind: kind as LineKind, text, ...(failed ? { failed } : {}) }];
	});
}

const OAUTH = "Usar OAuth no MCP do WhatsApp";

export const CASES: Case[] = [
	{
		name: "message: the first one titles the session and starts its task",
		why: "the session needs a title from the start, broader than its first task",
		request: {
			moment: "message",
			state: emptyTasks(),
			message:
				"ok, pesquisa como podemos expor um oauth ao inves de api key... beleza? vamos pesquisar a respeito, vai dar bom!\n\npq isso? pq isso eh mais seguro, podemos deixar um login com senha ou algo assim\n\nvamos fazer isso, vamos pensar em como implementar oauth com isso dai... ok? no mcp;",
		},
		// Finding out how and then building it may read as one task or two, never as English.
		expect: {
			title: "set",
			added: [1, 2],
			mentions: [/oauth/i],
			wrongLanguage: /\b(the|instead|research|how|implement|expose|plan|replace)\b/i,
		},
	},
	{
		name: "message: feedback on what is under way adds nothing",
		why: '"ficou desalinhado" opened a new step and pushed the real one to later',
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "done", "Commitar o OAuth na main"],
				["t2", "doing", "Criar um SVG com os casos de uso no README"],
			]),
			reply: "O SVG está no README, com os três casos de uso lado a lado.",
			message: "ficu meio desalinhado... e e poderia ser melhorzinho",
		},
		expect: { added: [0, 0], status: { t2: "doing", t1: "done" } },
	},
	{
		name: "message: feedback on done work reopens it",
		why: '"o de antes tava melhor" is about a task marked done',
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "done", "Criar um SVG com os casos de uso no README"],
				["t2", "doing", "Melhorar a UI de todas as páginas"],
			]),
			reply: "Redesenhei o SVG com cards e ícones para cada cliente.",
			message: "cara, esse svg ai ficou uma bosta, o de antes tava melhor, bem mais intuitivo....",
		},
		expect: { added: [0, 0], status: { t1: "doing" } },
	},
	{
		name: "message: a short yes picks up what waited on you",
		why: '"beleza, pode fazer push" only means something next to what the agent asked',
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "done", "Colocar o crédito no rodapé"],
				[
					"t2",
					"waiting",
					"Fazer commit e push na main",
					{ waitingOn: "you", why: "criar o SECRET em produção antes do push" },
				],
			]),
			reply:
				"Está tudo commitado na `main` local, mas ainda não fiz o push. Rode `bunx wrangler secret put SECRET`. Quando você avisar, eu faço o push.",
			message: "beleza, pode fazer push;",
		},
		expect: { added: [0, 0], status: { t2: "doing" } },
	},
	{
		name: "message: several asks start the first and queue the rest",
		why: "a message with a commit, a release and a post became one step and two later items with no order",
		request: {
			moment: "message",
			state: tasks(OAUTH, [["t1", "done", "Colocar o crédito no rodapé"]]),
			message:
				"beleza, vamos fazer commit e push, e vamos criar a nossa release 1.0.0!!!! finalmente, vamos escrever bem que isos eh uma reescrita da antiga implementacao, oq isso traz consigo e boa; e vamos escrever tbm um breve post, pequeno falando sobre mcp!",
		},
		expect: { added: [2, 4], mentions: [/release|1\.0\.0/i, /post/i] },
	},
	{
		name: "message: asking for a push is not saying it was done",
		why: '"vamos fazer commit e push" closed the push task as done by you',
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "done", "Colocar o crédito no rodapé"],
				["t2", "queued", "Fazer commit e push na main"],
			]),
			message:
				"beleza, vamos fazer commit e push, e vamos criar a nossa release 1.0.0!!!! finalmente",
		},
		expect: { open: ["t2"] },
	},
	{
		name: "message: a choice you make is kept as a decision",
		why: "the session lost why it had one secret with a mode, which compaction needs",
		request: {
			moment: "message",
			state: tasks(OAUTH, [["t1", "doing", "Pesquisar como expor OAuth no MCP"]]),
			reply: "Agora implemento. Instalo a dependência numa branch local:",
			busy: true,
			message:
				"ou, ao inves de fazer assim, podemos faazer assim:\n\nSECRET\n\ne um descrminnante de tipo\n\nAPI_KEY, OAUTH, BOTH saca?\n\nai a gente usa um unico secret saca?",
		},
		expect: { decided: 1, mentions: [/secret/i] },
	},
	{
		name: "message: a plan with its parts is one task, not one per step",
		why: "a pasted deploy plan became eight tasks, one per step, and most stayed queued",
		request: {
			moment: "message",
			state: emptyTasks(),
			message: fixture("deploy-plan"),
		},
		expect: { added: [1, 3], title: "set" },
	},
	{
		name: "message: saying something is fine as it is asks for nothing",
		why: '"esse painel admin, todo mundo pode acessar, ta suave" became a task to protect the panel',
		request: {
			moment: "message",
			state: tasks("Anotar com várias pessoas", [
				["t1", "doing", "Evitar que dois annotators fiquem no mesmo prompt"],
			]),
			busy: true,
			message:
				"e sobre frontend, adiciona uns icones legais tbm; coloca uns icons dahora nas coisasa; nas opcoes, navegacao e tals ah e esse painel admin, todo mundo pode acessar, ta suave",
		},
		// Recording the open panel as a task is loose; turning it into its opposite is the error.
		expect: { added: [1, 2], mentions: [/[íi]cone/i], none: /proteg|autentic|restring/i },
	},
	{
		name: "message: a step you confirm is no decision",
		why: '"we\'ll tag v1.0.0 and release it, right?" was kept as a decision, beside the task it is',
		request: {
			moment: "message",
			state: tasks(OAUTH, [["t1", "doing", "Criar a release 1.0.0 no GitHub"]]),
			message:
				"note que, essa release eh do ptojeto... ok? a gente vai fazer a tag v1.0.0 e fazer a release no github... certinho saca?",
		},
		expect: { decidedAtMost: 0, added: [0, 0] },
	},
	{
		name: "message: a status you paste closes nothing and adds nothing",
		why: '"ta certinho, pow" over a JSON was read as a done for an unrelated step',
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "doing", "Colocar a imagem no rodapé"],
				["t2", "queued", "Testar o histórico com um sync real", { origin: "agent" }],
			]),
			message:
				'o status retornou isso daqui: { "state": "open", "me": "558294011841@s.whatsapp.net", "qrSvg": null, "lastError": null, "archive": { "people": 3115, "chats": 2064, "messages": 32923 } } ta certinho, pow',
		},
		expect: { added: [0, 0], open: ["t1", "t2"] },
	},
	{
		name: "message: a question changes nothing",
		why: "a question is not an ask",
		request: {
			moment: "message",
			state: tasks(OAUTH, [["t1", "doing", "Publicar a versão 1.0.0"]]),
			message:
				"ok... se esta rodando coisa antiga... pq entao quando eu dei push nao derrubou o negocio e ligou denovo entre um deploy e outro?",
		},
		expect: { added: [0, 0], status: { t1: "doing" } },
	},
	{
		name: "message: what you ran yourself is done",
		why: "you are the only one who can say a command of yours ran",
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "waiting", "Criar o SECRET em produção", { waitingOn: "you" }],
				["t2", "queued", "Fazer push na main"],
			]),
			message: "rodei o wrangler secret put SECRET aqui, pode seguir com o push",
		},
		expect: { status: { t1: "done" }, added: [0, 0] },
	},
	{
		name: "message: what you put off is deferred, not dropped",
		why: "later used to mean four things",
		request: {
			moment: "message",
			state: tasks(OAUTH, [
				["t1", "doing", "Criar a release 1.0.0 no GitHub"],
				["t2", "queued", "Escrever um post curto sobre MCP"],
			]),
			message: "deixa o post pra depois, primeiro a release",
		},
		expect: { status: { t2: "deferred", t1: "doing" }, added: [0, 0] },
	},

	{
		name: "run: a run that took asks while it worked closes each one it reports",
		why: "six messages arrived during one run; only the last step could close, and the rest stayed in later forever",
		request: {
			moment: "run",
			state: tasks(OAUTH, [
				["t1", "doing", "Pesquisar como expor OAuth no MCP"],
				["t2", "queued", "Usar um único SECRET com modo de autenticação"],
				["t3", "queued", "Simplificar o código e cortar comentários"],
				["t4", "queued", "Mostrar o carregamento do histórico de mensagens"],
				["t5", "queued", "Explicar o auth mode no .dev.vars.example"],
			]),
			run: fixture("oauth-steered"),
		},
		expect: {
			status: { t2: "done", t4: "done", t5: "done" },
			worked: ["t3"],
			result: { t2: /SECRET|AUTH_MODE/ },
		},
	},
	{
		name: "run: work reported together closes each task it did, not the one under way",
		why: "the reservation of prompts was closed as the result of the cost preview, and its own task stayed queued",
		request: {
			moment: "run",
			state: tasks("Publicar o evals e anotar com várias pessoas", [
				["t1", "done", "Corrigir o deploy do evals no ranqia-infra"],
				["t2", "doing", "Mostrar o preview de custo itemizado, acumulado e total"],
				["t3", "queued", "Evitar que dois annotators fiquem no mesmo prompt"],
				["t4", "queued", "Adicionar ícones na navegação e nas opções"],
			]),
			run: fixture("annotators-reserve"),
		},
		expect: {
			status: { t3: "done", t4: "done" },
			result: { t3: /reserva|fila|prompt/i },
		},
	},
	{
		name: "run: a push the agent asks about waits on you",
		why: "a step that waits on your answer was neither done nor later",
		request: {
			moment: "run",
			state: tasks(OAUTH, [
				["t1", "doing", "Fazer commit e push na main"],
				["t2", "queued", "Arredondar as bordas das imagens do README"],
			]),
			run: [
				"L1 you: beleza, vamos fazer commit e push, mas pode fazer isso direto na main mesmo;",
				"L2 call: bash git add -A && git commit -m 'feat: oauth'",
				"L3 call: bash bunx wrangler secret list",
				"L4 report: Está tudo commitado na `main` local, mas ainda não fiz o push. A produção só tem o secret `API_KEY`, e sem um `SECRET` todas as rotas responderiam 500 assim que o push publicasse. Rode isto na pasta do projeto, colando o valor que quiser (o da `API_KEY` atual serve):",
				"L5 report: ```sh bunx wrangler secret put SECRET ```",
				"L6 report: Quando você avisar, eu faço o push. São 4 commits, e o Workers Builds vai publicar a versão nova.",
			].join("\n"),
		},
		expect: { status: { t1: "waiting", t2: "queued" }, waitingOn: { t1: "you" } },
	},
	{
		name: "run: a run that only announced its work closes nothing",
		why: "a line like 'Agora implemento:' is a plan, not a result",
		request: {
			moment: "run",
			state: tasks(OAUTH, [["t1", "doing", "Implementar OAuth no MCP"]]),
			run: [
				"L1 said: Pesquisei. Dá para fazer com o `@cloudflare/workers-oauth-provider`.",
				"L2 said: Agora implemento. Instalo a dependência numa branch local:",
				"L3 call: bash git checkout -b feat/oauth",
				"L4 call: bash bun add @cloudflare/workers-oauth-provider",
				"L5 report: Agora o roteador:",
			].join("\n"),
		},
		expect: { open: ["t1"] },
	},
	{
		name: "run: a claim right after a failed call is no proof",
		why: "a model that read 'publiquei' after a failed publish recorded it",
		request: {
			moment: "run",
			state: tasks(undefined, [["t1", "doing", "Publicar o pacote no npm"]]),
			run: [
				"L1 call: bash npm publish --access public (failed or refused: it did not happen)",
				"L2 report: Publiquei o pacote no npm.",
			].join("\n"),
		},
		expect: { open: ["t1"] },
	},
	{
		name: "run: a finding is done, with what it found",
		why: "the result of an investigation is what a later reader needs",
		request: {
			moment: "run",
			state: tasks("Fazer o login OAuth do MCP funcionar", [
				["t1", "done", "Descobrir a causa do 404 no login OAuth"],
				["t2", "doing", "Procurar issue sobre o bug no repo do pi"],
			]),
			run: [
				"L1 you: beleza, veja o repo do pi, veja se tem alguma issue a respeito disso, ou se tem alguma canal de report;",
				"L2 call: bash gh issue list -R earendil-works/pi --search 'oauth metadata cache'",
				"L3 call: bash gh search code -R earendil-works/pi authServerMetadataUrl",
				"L4 report: I found no issue or PR about this in `earendil-works/pi`, and the cache code on `main` still behaves the same, so it isn't fixed yet. The closest related issue is #10172 (closed), which added `oauth.authServerMetadataUrl`.",
				"L5 report: Bugs go in the issue tracker; there is a template with sections for the version and the steps.",
			].join("\n"),
		},
		expect: { status: { t2: "done" }, result: { t2: /10172|issue/i } },
	},

	{
		name: "tidy: two tasks for the same work become one",
		why: "repeats piled up in later",
		request: {
			moment: "tidy",
			state: tasks(OAUTH, [
				["t1", "done", "Usar um único SECRET com modo de autenticação"],
				["t2", "queued", "Fazer commit e push na main"],
				["t3", "queued", "Commit and push the changes to main"],
			]),
		},
		expect: { openMatching: [/push/i, 1], status: { t1: "done" } },
	},
	{
		name: "tidy: a clean list stays as it is",
		why: "the tidy pass rewrote what was fine",
		request: {
			moment: "tidy",
			state: tasks(OAUTH, [
				["t1", "done", "Pesquisar como expor OAuth no MCP"],
				["t2", "doing", "Usar um único SECRET com modo de autenticação"],
			]),
		},
		expect: { status: { t1: "done", t2: "doing" }, title: "kept" },
	},
];
