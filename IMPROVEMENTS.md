# IMPROVEMENTS — Idea Refinement Extension

Análise completa do codebase realizada em 2026-05-03.  
Cada item é classificado por **prioridade** (P0 = crítica, P1 = alta, P2 = média, P3 = baixa) e **categoria**.

---

## 1. Correções de Bugs e Comportamento

### 1.1 — `manifestWriteCount` é estado global mutável sem reset
**Arquivo:** `lib/manifest.ts`  
**Prioridade:** P1  
**Categoria:** Bug  

`manifestWriteCount` é exportado como `let` e incrementado a cada `saveManifest`. Nunca é resetado entre execuções, acumulando valor indefinidamente. Em testes ou execuções múltiplas, o contador reflete o total acumulado, não o da execução corrente.

**Correção sugerida:** Converter para classe ou adicionar `resetManifestWriteCount()`. Alternativamente, mover o contador para dentro do `WorkflowManifest`.

---

### 1.2 — `ensureLoopDirectory` cria diretórios em ordem invertida
**Arquivo:** `lib/path-utils.ts` (linha ~110)  
**Prioridade:** P3  
**Categoria:** Consistência  

`loopLogsDir` é criado antes de `loopDir`. Embora `recursive: true` torne isso funcional, a ordem é logicamente invertida e dificulta a leitura.

```typescript
// Atual
const loopLogsDir = path.join(loopDir, "logs");
await fs.mkdir(loopLogsDir, { recursive: true });
await fs.mkdir(loopDir, { recursive: true });

// Sugerido
await fs.mkdir(loopDir, { recursive: true });
await fs.mkdir(path.join(loopDir, "logs"), { recursive: true });
```

---

### 1.3 — Prompts órfãos após merge D5 (evaluate + learning)
**Arquivo:** `lib/prompts.ts`  
**Prioridade:** P2  
**Categoria:** Dead code  

Após o merge de evaluate+learning em um único subprocesso (D5 fix), os prompts separados `EVALUATION_SYSTEM_PROMPT` e `LEARNING_UPDATE_SYSTEM_PROMPT` ainda são exportados e testados, mas nunca utilizados no workflow. As funções `buildEvaluationUserPrompt` e `buildLearningUpdateUserPrompt` também são dead code.

**Correção sugerida:** Remover ou marcar como `@deprecated`. Se houver intenção de reutilização futura, mover para arquivo separado.

---

### 1.4 — Snapshot scope hardcoded no workflow
**Arquivo:** `lib/workflow.ts` (linhas ~195, ~210)  
**Prioridade:** P2  
**Categoria:** Configurabilidade  

O escopo do snapshot C7 está hardcoded como `["lib", "tests"]`:

```typescript
const snapshotBefore = await takeSnapshot(cwd, { scope: ["lib", "tests"], maxDepth: 6, maxFiles: 5000 });
```

Isso funciona para este projeto específico, mas torna a extensão inutilizável para outros projetos que não seguem essa estrutura de diretórios.

**Correção sugerida:** Tornar o scope configurável via `WorkflowRunInput` ou detectar automaticamente a estrutura do projeto.

---

### 1.5 — `takeSnapshot` só captura arquivos `.ts`
**Arquivo:** `lib/post-hoc-check.ts`  
**Prioridade:** P2  
**Categoria:** Limitação  

A função `takeSnapshot` filtra apenas `*.ts`. Projetos com componentes `.js`, `.json`, `.md` ou outros tipos relevantes terão mudanças materiais ignoradas no critério C7.

**Correção sugerida:** Tornar a extensão de arquivo configurável via `TakeSnapshotOptions` (ex: `extensions: [".ts", ".js", ".json"]`).

---

### 1.6 — Extração de seções marcadas frágil com conteúdo mínimo fixo
**Arquivo:** `lib/marker-parser.ts`  
**Prioridade:** P3  
**Categoria:** Robustez  

`MIN_SECTION_CONTENT_LENGTH = 10` é fixo. Seções legítimas com menos de 10 caracteres não-branco (ex: uma métrica numérica curta) serão rejeitadas.

**Correção sugerida:** Tornar o limite configurável ou reduzir para 3-5 caracteres, já que a validação de conteúdo real é feita pelo `response-validator`.

---

## 2. Problemas de Performance

### 2.1 — `isRootInTerminalState` faz leitura síncrona de arquivo em hot path
**Arquivo:** `artifact-guard.ts`  
**Prioridade:** P1  
**Categoria:** Performance  

Cada `write`/`edit` tool call consulta `isRootInTerminalState`. Em cache miss, `readFileSync` bloqueia o event loop. O manifesto pode ter dezenas de KB.

**Correção sugerida:** Usar `fs.readFile` assíncrono com lock ou popule o cache no início do workflow (já feito parcialmente pelo `terminalStateCache`).

---

### 2.2 — `takeSnapshot` lê arquivos sequencialmente
**Arquivo:** `lib/post-hoc-check.ts`  
**Prioridade:** P2  
**Categoria:** Performance  

A função `walkDir` usa `await fs.readFile` dentro de um loop `for...of`, processando um arquivo por vez.

**Correção sugerida:** Usar `Promise.all` com concorrência limitada (ex: 10 arquivos simultâneos) ou `Promise.allSettled` para ler em paralelo.

---

### 2.3 — `resolveGuardExtensionPath` usa `existsSync` em tempo de módulo
**Arquivo:** `lib/runner.ts`  
**Prioridade:** P3  
**Categoria:** Performance  

A função é chamada no topo do módulo, executando I/O síncrono na importação. Em ambientes com muitas importações, isso adiciona latência desnecessária.

**Correção sugerida:** Usar lazy initialization (getter) ou mover para dentro de `buildPiArgs`.

---

### 2.4 — `shouldUseUnicode` recalculada a cada renderização do widget
**Arquivo:** `lib/ui-monitor.ts`  
**Prioridade:** P3  
**Categoria:** Performance  

`buildIdeaRefinementWidgetLines` chama `shouldUseUnicode()` a cada invocação, mas o resultado nunca muda durante a execução do processo.

**Correção sugerida:** Cache o resultado em uma variável de módulo na primeira chamada.

---

## 3. Problemas de Design e Arquitetura

### 3.1 — `emitWorkflowEvent` é wrapper desnecessário
**Arquivo:** `lib/workflow.ts`  
**Prioridade:** P3  
**Categoria:** Design  

A função `emitWorkflowEvent(onEvent, event)` simplesmente chama `onEvent?.(event)`. Não adiciona lógica, validação ou transformação.

**Correção sugerida:** Remover a função e chamar `onEvent?.(event)` diretamente, ou adicionar lógica real (ex: buffer, debounce, validação de schema).

---

### 3.2 — Lógica de throttle/debounce confusa no index.ts
**Arquivo:** `index.ts`  
**Prioridade:** P2  
**Categoria:** Design  

Existem duas constantes com propósitos similares:
- `RENDER_DEBOUNCE_MS = 150` (usado no setTimeout)
- `RENDER_THROTTLE_MS = 1000` (usado para throttle)

A função `scheduleRender` tenta ambos, mas a lógica é difícil de seguir: o throttle previne re-renders rápidos, mas o debounce de 150ms pode disparar antes do throttle expirar.

**Correção sugerida:** Consolidar em uma única estratégia de rate-limiting com documentação clara do comportamento esperado.

---

### 3.3 — `applyStateUpdate` usa cast inseguro
**Arquivo:** `lib/ui-monitor.ts`  
**Prioridade:** P2  
**Categoria:** Type safety  

```typescript
(state as unknown as Record<string, unknown>)[key] = value;
```

Este cast bypassa completamente o TypeScript. Um typo na chave do `Partial<IdeaRefinementMonitorState>` não será detectado em tempo de compilação.

**Correção sugerida:** Usar `Object.assign(state, update)` ou iterar com type-safe keys.

---

### 3.4 — Validação de resposta com lógica de scoring complexa
**Arquivo:** `lib/response-validator.ts`  
**Prioridade:** P2  
**Categoria:** Manutenibilidade  

A função `validateResponse` tem pesos diferentes por `strictness` ("fast" vs "full") com pontuações que somam 100 ou 85 dependendo do modo. A lógica de cada check está intercalada com cálculo de pontos, tornando difícil adicionar ou modificar checks.

**Correção sugerida:** Separar a definição dos checks (strategy pattern) do cálculo de pontuação. Cada check poderia ser um objeto `{ name, evaluate, weightFast, weightFull }`.

---

### 3.5 — Verificação C3 (alternativas) conta todas as linhas de tabela
**Arquivo:** `lib/response-validator.ts`  
**Prioridade:** P2  
**Categoria:** Bug lógico  

```typescript
const altLines = text.split("\n").filter((l) => l.startsWith("|") && l.includes("|"));
const hasAlternatives = altLines.length >= 4;
```

Qualquer tabela no documento (ex: BACKLOG.md referenciado) é contada como "alternativas". Um RESPONSE.md sem matriz de alternativas mas com tabelas em outras seções passaria neste check.

**Correção sugerida:** Escopo a verificação para a seção "## Minimum alternatives matrix" apenas.

---

### 3.6 — Check C7 (fast mode) inconsistente na detecção de "Adopt"
**Arquivo:** `lib/response-validator.ts`  
**Prioridade:** P3  
**Categoria:** Consistência  

```typescript
const hasAdopt = /\b[Aa]dopt\b/.test(text);
```

Aceita "Adopt" e "Adopt" mas rejeita "ADOPT" ou "aDOPT". A mensagem de erro diz "'Adopt' found" mas o regex também captura "adopt".

**Correção sugerida:** Tornar case-insensitive: `/\badopt\b/i`.

---

## 4. Testes Faltantes

### 4.1 — Sem testes para o módulo principal (`index.ts`)
**Prioridade:** P1  
**Categoria:** Test coverage  

O handler do comando `/idea-refine` não possui testes. Aspectos não testados:
- Prevenção de execução concorrente (`runInProgress`)
- Validação de modelo ausente
- Validação de modo interativo
- Coleta de ideia via editor
- Coleta de loop count com retry
- Tratamento de erros no workflow
- Cleanup do timer de renderização

**Correção sugerida:** Extrair a lógica de negócio do handler para funções testáveis e criar testes unitários.

---

### 4.2 — Sem testes para timeout e sinais no `runPiStage`
**Prioridade:** P1  
**Categoria:** Test coverage  

O `runPiStage` tem lógica de timeout (D3 fix) e propagação de sinais (D4 fix) que não são testados:
- `timeoutMs` configurado dispara SIGTERM após o período
- Sinais SIGTERM/SIGINT do processo pai são propagados ao subprocesso
- `exitCode === null` (SIGKILL/OOM) é tratado como falha (E4 fix)

**Correção sugerida:** Criar testes com subprocessos que propositalmente excedam timeout ou respondam a sinais.

---

### 4.3 — Sem testes para `extractJsonStringValueAfter`
**Prioridade:** P2  
**Categoria:** Test coverage  

Esta função de parsing de JSON por regex é frágil e não possui testes unitários. Casos como strings com aspas escapadas, vírgulas dentro de valores, ou campos ausentes não são verificados.

---

### 4.4 — Sem testes para `finalizeWriteStream`
**Prioridade:** P2  
**Categoria:** Test coverage  

A função lida com edge cases (stream já finalizada, stream destruída) mas não há testes verificando esses cenários.

---

### 4.5 — Sem testes para `shouldPersistStdoutLogLine`
**Prioridade:** P3  
**Categoria:** Test coverage  

O filtro de linhas stdout usa regex complexa mas não é testado diretamente.

---

## 5. Segurança

### 5.1 — Ambiente do subprocesso herda `process.env` completo
**Arquivo:** `lib/runner.ts`  
**Prioridade:** P2  
**Categoria:** Segurança  

```typescript
env: {
    ...process.env,
    [PROTECTED_ROOTS_ENV]: JSON.stringify(protectedRoots),
},
```

Variáveis de ambiente sensíveis (tokens, senhas, API keys) são propagadas ao subprocesso. Se o subprocesso `pi` fizer logging ou telemetry, esses valores podem vazar.

**Correção sugerida:** Filtrar o ambiente do subprocesso para incluir apenas variáveis necessárias (PATH, HOME, NODE_PATH, etc.) ou usar uma allowlist.

---

### 5.2 — Sem sanitização do input da ideia
**Arquivo:** `lib/workflow.ts`, `lib/prompts.ts`  
**Prioridade:** P3  
**Categoria:** Segurança  

A ideia fornecida pelo usuário é inserida diretamente no prompt sem sanitização. Embora o prompt seja enviado ao modelo via `--append-system-prompt` (arquivo temporário), o conteúdo da ideia vai como argumento de linha de comando, potencialmente exposto em listagens de processos (`ps aux`).

**Correção sugerida:** Escrever o user prompt em arquivo temporário (como já feito com o system prompt) em vez de passar como argumento.

---

## 6. Documentação

### 6.1 — README não documenta o sistema de validação
**Prioridade:** P2  
**Categoria:** Documentação  

O `response-validator.ts` e `validator-check.ts` implementam um sistema de validação epistêmica com 8 critérios (C1-C8), dois modos de strictness, e thresholds diferentes. Nada disso é mencionado no README.

**Correção sugerida:** Adicionar seção "Validation System" ao README explicando os critérios, modos, e como interpretar o `validator-check-output.md`.

---

### 6.2 — Comentários de fix referenciam issue trackers internos
**Prioridade:** P3  
**Categoria:** Documentação  

Comentários como `// D5 fix:`, `// C1 fix:`, `// R1 fix:` referenciam issues sem link ou contexto. Para contribuidores externos, são opacos.

**Correção sugerida:** Converter para formato padrão com contexto: `// NOTE: merged evaluate+learning to reduce cold starts (D5)` ou usar conventional commits.

---

### 6.3 — Ausência de JSDoc em funções públicas
**Prioridade:** P3  
**Categoria:** Documentação  

Funções exportadas como `runIdeaRefinementWorkflow`, `validateResponse`, `takeSnapshot`, etc. não possuem JSDoc. O TypeScript infere tipos, mas a semântica (preconditions, side effects, error behavior) não está documentada.

---

## 7. Configurabilidade

### 7.1 — Timeouts hardcoded
**Arquivo:** `lib/runner.ts`, `lib/workflow.ts`  
**Prioridade:** P2  
**Categoria:** Configurabilidade  

- Default timeout: 10 minutos (runner.ts)
- Develop stage timeout: 15 minutos (workflow.ts)
- Snapshot limits: `maxDepth: 6, maxFiles: 5000` (workflow.ts)

Esses valores não podem ser configurados pelo usuário.

**Correção sugerida:** Expor via `WorkflowRunInput` ou variáveis de ambiente (ex: `PI_IDEA_REFINEMENT_TIMEOUT_MS`).

---

### 7.2 — Thresholds de validação fixos
**Arquivo:** `lib/validation-constants.ts`, `lib/response-validator.ts`  
**Prioridade:** P3  
**Categoria:** Configurabilidade  

`MIN_LINE_COUNT = 50`, `MIN_TAG_COUNT = 3`, `MIN_FACT_COUNT = 2` são constantes hardcoded. Para projetos menores ou maiores, esses limites podem ser inadequados.

---

## 8. Melhorias de Robustez

### 8.1 — `findNextCallNumber` silencia todos os erros
**Arquivo:** `lib/path-utils.ts`  
**Prioridade:** P2  
**Categoria:** Robustez  

```typescript
} catch {
    return 1;
}
```

Qualquer erro (permissão, disco cheio, symlink quebrado) é silenciado e o número 1 é retornado. Isso pode causar sobrescrita de diretórios existentes se o erro for transiente.

**Correção sugerida:** Distinguir `ENOENT` (diretório não existe → retornar 1) de outros erros (propagar ou logar).

---

### 8.2 — `runPiStage` pode mascarar erros no `finally`
**Arquivo:** `lib/runner.ts`  
**Prioridade:** P2  
**Categoria:** Robustez  

O bloco `finally` tenta finalizar streams e limpar arquivos temporários. Se `finalizeWriteStream` lançar, o erro original do subprocesso pode ser perdido.

**Correção sugerida:** Usar `try/catch` interno no `finally` (já feito parcialmente, mas o primeiro `try` pode lançar antes do segundo).

---

### 8.3 — `extractMarkedSections` não valida ordem das seções
**Arquivo:** `lib/marker-parser.ts`  
**Prioridade:** P3  
**Categoria:** Robustez  

Seções podem aparecer em qualquer ordem e com conteúdo entre elas. Conteúdo entre seções é ignorado silenciosamente, podendo esconder erros do agente.

**Correção sugerida:** Emitir warning quando texto significativo for detectado entre seções.

---

## 9. Melhorias de API e Interface

### 9.1 — `WorkflowRunInput` não expõe configuração de snapshot
**Prioridade:** P2  
**Categoria:** API  

O escopo do snapshot C7, maxDepth, e maxFiles não são configuráveis externamente.

**Correção sugerida:** Adicionar campo `snapshotConfig?: TakeSnapshotOptions` ao `WorkflowRunInput`.

---

### 9.2 — `StageExecutionResult` não inclui duração da stage
**Prioridade:** P3  
**Categoria:** API  

O manifest registra `startedAt` e `completedAt`, mas o `StageExecutionResult` retornado não inclui duração. Calcular a duração requer acesso ao manifest.

**Correção sugerida:** Adicionar `durationMs: number` ao `StageExecutionResult`.

---

### 9.3 — `WorkflowProgressEvent` não inclui timestamp
**Prioridade:** P3  
**Categoria:** API  

Eventos de progresso não têm timestamp. Consumidores que querem logging ou timeline precisam adicionar timestamps externamente.

**Correção sugerida:** Adicionar `timestamp: string` (ISO) a cada evento.

---

## 10. Melhorias de Testabilidade

### 10.1 — `GUARD_EXTENSION_PATH` calculada em tempo de importação
**Arquivo:** `lib/runner.ts`  
**Prioridade:** P2  
**Categoria:** Testabilidade  

A constante `GUARD_EXTENSION_PATH` é computada quando o módulo é importado, usando `fs.existsSync`. Isso dificulta testes que precisam de caminhos diferentes.

**Correção sugerida:** Tornar lazy (getter) ou injetável via opções.

---

### 10.2 — `runInProgress` não é resetável em testes
**Arquivo:** `index.ts`  
**Prioridade:** P2  
**Categoria:** Testabilidade  

A flag `runInProgress` é closure-scoped. Testes não conseguem resetá-la entre execuções, impossibilitando testar prevenção de execução concorrente.

**Correção sugerida:** Expor via API de teste ou usar um estado injetável.

---

## Resumo por Prioridade

| Prioridade | Quantidade | Itens |
|------------|------------|-------|
| **P0** | 0 | — |
| **P1** | 3 | manifestWriteCount, leitura síncrona no hot path, testes do módulo principal |
| **P2** | 14 | Prompts órfãos, snapshot hardcoded, throttle confuso, cast inseguro, scoring complexo, C3 bug, timeout fixo, erros silenciados, ambiente do subprocesso, documentação validation, snapshot config, GUARD_EXTENSION_PATH, runInProgress |
| **P3** | 11 | Ordem de criação de diretórios, MIN_SECTION_CONTENT_LENGTH, shouldUseUnicode cache, C7 Adopt, emitWorkflowEvent, JSDoc, comments de fix, extractMarkedSections ordem, StageExecutionResult duração, shouldPersistStdoutLogLine, finalizeWriteStream |

---

## Sugestão de Execução

1. **Sprint 1 (P1):** Corrigir `manifestWriteCount`, tornar `isRootInTerminalState` assíncrono, criar testes para `index.ts`
2. **S2 (P2 - bugs):** Corrigir C3 escopo, remover prompts órfãos, tornar snapshot scope configurável
3. **S3 (P2 - design):** Consolidar throttle/debounce, refatorar `validateResponse`, corrigir cast inseguro
4. **S4 (P2 - infra):** Tornar timeouts configuráveis, filtrar env do subprocesso, tornar `findNextCallNumber` robusto
5. **S5 (P3):** Melhorias de consistência, performance menor, documentação
