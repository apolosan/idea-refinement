# Idea Refinement Extension

Extensão para o [Pi Coding Agent](https://pi.dev) que executa, por código e em ordem forçada, um workflow iterativo de refinamento de ideias.

## Instalação

### Via Pi (recomendado)

```bash
pi install npm:@apolosan/idea-refinement
```

Ou para instalação local no projeto:

```bash
pi install -l npm:@apolosan/idea-refinement
```

### Via npm

```bash
npm install -g @apolosan/idea-refinement
```

E depois adicione ao seu `settings.json` do Pi:

```json
{
  "packages": ["npm:@apolosan/idea-refinement"]
}
```

## Pré-requisitos

- **Node.js ≥ 22** (usa `--experimental-strip-types`)

## O que ela faz

Com o comando `/idea-refine`, a extensão:

1. recebe a ideia do usuário;
2. pergunta quantos loops devem ser executados;
3. gera os artefatos iniciais:
   - `DIRECTIVE.md`
   - `LEARNING.md`
   - `CRITERIA.md`
   - `DIAGNOSIS.md`
   - `METRICS.md`
   - `BACKLOG.md`
4. executa, para cada loop:
   - desenvolvimento da ideia → `RESPONSE.md`
   - avaliação crítica → `FEEDBACK.md`
   - atualização cumulativa de aprendizado → `LEARNING.md`
5. salva tudo em um diretório isolado por chamada;
6. exibe, em tempo real, o andamento do workflow de forma visível ao usuário:
   - notificações no console/chat do Pi para início, etapas, conclusão de loops e falhas;
   - loop atual e total de loops;
   - barra de progresso dos loops;
   - etapa atual do workflow;
   - ferramenta em execução.

## Como usar

No Pi, execute:

```text
/idea-refine
```

Ou, para uma ideia curta:

```text
/idea-refine Quero validar uma plataforma para entrevistas técnicas assistidas por IA.
```

Depois disso, a extensão pedirá a quantidade de loops.

## Monitor em tempo real

Durante a execução, a extensão:

- publica eventos importantes no console/chat do Pi (`workflow_started`, início/fim de etapas, conclusão de loop, falhas);
- atualiza `status` resumido no rodapé/working message;
- mantém um widget persistente com checklist de bootstrap, desenvolvimento, avaliação e aprendizado;
- exibe `ferramenta atual` em uso pelo subprocesso invocado;
- mostra uma barra de progresso textual dos loops.

## Diretórios e artefatos

Cada execução cria um diretório exclusivo:

```text
docs/idea_refinement/artifacts_call_01/
docs/idea_refinement/artifacts_call_02/
...
```

Estrutura gerada:

```text
docs/idea_refinement/artifacts_call_NN/
├── IDEA.md
├── DIRECTIVE.md
├── LEARNING.md
├── CRITERIA.md
├── DIAGNOSIS.md
├── METRICS.md
├── BACKLOG.md
├── RESPONSE.md          # versão mais recente
├── FEEDBACK.md          # versão mais recente
├── REPORT.md            # relatório consolidado final
├── CHECKLIST.md         # checklist de ações acionáveis
├── validator-check-output.md  # resultado da validação epistêmica
├── run.json             # manifesto estruturado da execução
├── logs/
│   ├── bootstrap.jsonl
│   ├── loop_01_develop.jsonl
│   ├── loop_01_evaluate.jsonl
│   └── loop_01_learning.jsonl
└── loops/
    ├── loop_01/
    │   ├── RESPONSE.md
    │   ├── FEEDBACK.md
    │   └── LEARNING.md
    └── loop_02/
        └── ...
```

## Como a ordem é forçada

A extensão não depende do agente atual para orquestrar o processo.

Ela própria:

- gera números aleatórios não-determinísticos via Mersenne Twister + entropia criptográfica para guiar o workflow;
- dispara subprocessos do próprio `pi` em sequência;
- injeta prompts de sistema específicos por etapa;
- captura o texto final de cada subprocesso;
- grava os artefatos por código;
- atualiza `run.json` durante toda a execução.

## Variável de ambiente

### `PI_IDEA_REFINEMENT_PROTECTED_ROOTS`

Esta variável de ambiente é usada internamente pela extensão para proteger os diretórios de artefatos contra escrita durante a execução do workflow. O `artifact-guard.ts` bloqueia operações de `write` e `edit` em caminhos protegidos até que o workflow atinja um estado terminal (`success` ou `failed`).

**Não é necessário configurar manualmente** — a extensão a define automaticamente ao iniciar cada subprocesso.

## Salvaguardas implementadas

- `DIRECTIVE.md` é criada uma única vez e nunca mais é regravada.
- `DIAGNOSIS.md`, `METRICS.md` e `BACKLOG.md` tornam o refinement mais observável, comparável e auditável.
- Os subprocessos de cada etapa recebem uma extensão auxiliar (`artifact-guard.ts`) que bloqueia `write` e `edit` sobre o diretório de artefatos.
- O conteúdo final dos artefatos é persistido apenas pela extensão principal.
- Cada loop mantém snapshots próprios em `loops/loop_NN/`.

## Decisões de implementação

- O modelo ativo da sessão atual é reutilizado em todas as etapas.
- O nível de thinking ativo da sessão também é propagado aos subprocessos do workflow.
- O monitor em tempo real é alimentado por eventos estruturados (`message_update`, `tool_execution_start`, `tool_execution_end`) emitidos por cada subprocesso `pi --mode json`.
- O número aleatório inicial define apenas a política principal ativa da `DIRECTIVE.md`:
  - `1-80` → `OPTIMIZATION`
  - `81-100` → `CREATIVITY/EXPLORATION`
- A `DIRECTIVE.md` sempre inclui ambas as políticas (`OPTIMIZATION` e `CREATIVITY/EXPLORATION`); o sorteio só define qual delas fica marcada em `Selected Policy`.
- O número aleatório de cada loop é encaminhado ao agente de desenvolvimento como semente contextual, sem poder sobrescrever a diretiva.
- A extensão foi mantida modular para facilitar manutenção e testes.

## Testes

Rode os testes locais com Node 22+:

```bash
node --experimental-strip-types tests/run-tests.ts
```

Os testes cobrem:

- parsing de número de loops;
- detecção do próximo `artifacts_call_NN`;
- parsing dos marcadores dos artefatos iniciais e da atualização de `LEARNING.md` + `BACKLOG.md`;
- extração do `Overall score`;
- proteção de paths de artefatos;
- propagação do nível de thinking para os subprocessos;
- monitor de execução e thinking em tempo real;
- smoke import da extensão principal.

## Licença

MIT
