# FIX.md — Investigação Completa: Pontos a Corrigir e Melhorar

> Projeto: `@apolosan/idea-refinement`  
> Data: 2026-05-03  
> Status: ✅ Todas as correções aplicadas — 15/15 suites passando

---

## Correções Aplicadas

### Bugs Críticos ✅
| ID | Descrição | Status |
|----|-----------|--------|
| C1 | `manifest.report/checklist` nunca atualizado — agora usa objetos do manifest diretamente | ✅ |
| C2 | Snapshot C7 tirava foto da extensão, não do projeto — agora usa `cwd` | ✅ |
| C3 | `validator-check.ts` gravava em path errado e sem mkdir — agora grava no callDir com mkdir recursivo | ✅ |
| C4 | Erros de validação silenciados — agora logados via `console.error` | ✅ |
| C5 | Subprocesso não herda `--experimental-strip-types` — agora propaga `process.execArgv` | ✅ |

### Bugs de Teste ✅
| ID | Descrição | Status |
|----|-----------|--------|
| T1 | `validator-check.test.ts` isolamento quebrado — output agora no mesmo dir do RESPONSE.md | ✅ |
| T2 | `ui-monitor.test.ts` expectativa incorreta — `stage_failed` não muda `workflowStatus` | ✅ |
| T3 | `workflow.test.ts` não mockava runner — usa script fake com invocation override | ✅ |

### Design & Robustez ✅
| ID | Descrição | Status |
|----|-----------|--------|
| R1 | `artifact-guard` bypass por qualquer root terminal — agora verifica root específica | ✅ |
| S1 | `WORKING_MESSAGE_LIMIT` não usada — exportada e usada no `index.ts` | ✅ |
| S4 | Inconsistência case-insensitive em seções — `validator-check` agora aceita `toLowerCase` | ✅ |
| D3 | Runner sem timeout — padrão de 10 minutos, configurável via `timeoutMs` | ✅ |
| D4 | Sinais não propagados — `SIGTERM`/`SIGINT` propagados ao subprocesso | ✅ |

### Documentação ✅
| ID | Descrição | Status |
|----|-----------|--------|
| DOC1 | README `RUN.json` → `run.json` | ✅ |
| DOC2 | GitHub Actions CI adicionado | ✅ |
| DOC4 | `PI_IDEA_REFINEMENT_PROTECTED_ROOTS` documentado | ✅ |

### Interface de Invocation ✅
A interface `invocation` em `runPiStage` agora funciona como override de comando + args base:
- `args` do invocation são **prependidos** aos args gerados por `buildPiArgs`
- System prompt, model, user prompt etc. são sempre incluídos
- Permite testes com scripts fake que leem o system prompt

---

## Não Aplicado (intencional)
- **D2**: Algoritmo de números aleatórios — solicitado para não alterar
- **D1**: Motor de validação unificado — refactor grande, deixado para iteração futura
