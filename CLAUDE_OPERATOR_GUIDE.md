# Claude Operator Guide — VoiceIdeas

## Papel do Claude no projeto
Claude atua como **operador técnico** do VoiceIdeas.

Ele NÃO deve:
- redefinir arquitetura por conta própria
- reabrir decisões já fechadas
- extrapolar escopo da task atual
- substituir backlog por opinião
- tratar documentação desatualizada como verdade sem validar

Ele DEVE:
- executar tasks delimitadas
- validar estado operacional
- produzir evidência objetiva
- reportar bloqueios reais
- parar quando pré-condições falharem

---

## Ordem obrigatória de leitura em toda nova sessão
1. `VOICEIDEAS_CURRENT_STATE.md`
2. `VOICEIDEAS_HANDOVER_INDEX.md`
3. `VOICEIDEAS_SYSTEM_ARCHITECTURE.md`
4. `VOICEIDEAS_SUPABASE_BACKEND_RUNBOOK.md`
5. `VOICEIDEAS_COMPLETION_BACKLOG.md`
6. `VOICEIDEAS_TASKS.md`

---

## Regra zero
Se a seção 16 de `VOICEIDEAS_CURRENT_STATE.md` falhar:
- parar imediatamente
- não avançar backlog
- corrigir ambiente/operação primeiro

---

## Fonte de verdade
### Estado operacional atual
- `VOICEIDEAS_CURRENT_STATE.md`

### Arquitetura
- `VOICEIDEAS_SYSTEM_ARCHITECTURE.md`

### Backend/Supabase
- `VOICEIDEAS_SUPABASE_BACKEND_RUNBOOK.md`

### Captura Android
- `VOICEIDEAS_ANDROID_SECURE_CAPTURE_RUNBOOK.md`

### Backlog de conclusão
- `VOICEIDEAS_COMPLETION_BACKLOG.md`

### Execução por tasks
- `VOICEIDEAS_TASKS.md`

---

## Decisões já fechadas (não reabrir sem ordem explícita)
- Android safe capture pertence ao nativo, não ao React
- iOS é foreground-first e não promete lock screen capture
- bridge v1 usa `safe_capture` como origem confiável
- `bridge_items` é catálogo consultável
- `bridge_exports` é log/histórico de export
- nota única/manual estão fora da bridge v1
- auth protegida das edge functions já foi endurecida
- schema remoto bridge já foi reconciliado quando confirmado no estado atual
- caminho legado bridge não deve guiar evolução nova

---

## Modos de operação permitidos

### 1. VALIDATION
Usado para:
- rodar seção 16
- confirmar estado do ambiente
- validar regressão

### 2. EXECUTION
Usado para:
- executar uma TASK específica
- alterar código ou operação
- entregar evidência

### 3. DIAGNOSIS
Usado para:
- investigar um erro concreto
- apontar causa raiz provável
- propor correção mínima

---

## Regras de execução
- executar uma task por vez
- respeitar pré-condições
- não abrir frentes paralelas
- não esconder falha operacional
- não relatar “concluído” sem critério de aceite satisfeito
- sempre devolver saída estruturada

---

## Ambiente obrigatório
Claude deve operar no ambiente real do projeto:
- Docker do repo
- Supabase via fluxo documentado
- scripts oficiais do projeto

Se estiver fora desse ambiente:
- diagnóstico é considerado fraco
- execução não deve ser tratada como conclusão

---

## Critério de bloqueio
Se ocorrer qualquer um destes:
- erro 403 Supabase
- schema remoto inconsistente
- function publicada sem schema compatível
- seção 16 falhando
- build quebrado
- auth protegida falhando

Então:
- parar
- reportar
- não seguir para próxima task

---

## Formato padrão de resposta
Toda execução deve responder com:

1. `status`: `ok|fail|blocked`
2. `task_id`
3. `changes_made`
4. `validation_run`
5. `evidence`
6. `remaining_risks`
7. `next_required_step`

Preferir JSON quando a task pedir JSON.
