# VoiceIdeas Tasks — Claude Execution Format

## Como usar
- executar uma task por vez
- não pular pré-condições
- não alterar escopo
- sempre rodar validação obrigatória ao final

---

# P0

## TASK P0.1 — Consolidar bridge canônica e isolar legado

Objetivo:
Garantir que apenas o fluxo bridge v1 canônico esteja ativo e eliminar dependência operacional do legado.

Arquivos obrigatórios:
- `src/lib/bridgeExport.ts`
- `src/components/SendToBardoModal.tsx`
- `supabase/functions/bridge-exports/index.ts`
- `src/services/bridgeExportService.ts`
- `supabase/functions/export-to-cenax/index.ts`
- `supabase/functions/bridge-items/index.ts`

Passos:
1. buscar referências de legado:
   - `bridge-exports`
   - `owner_email`
   - `content_hash`
   - `SendToBardoModal`
2. mapear uso real no frontend e backend
3. validar fluxo canônico:
   - `bridge-items`
   - `export-to-cenax`
4. classificar cada ponto legado:
   - `ativo`
   - `não utilizado`
   - `incerto`
5. remover, desabilitar ou isolar o legado sem quebrar o canônico

Critério de sucesso:
- nenhum fluxo principal depende de legado
- export canônico funciona para `note` e `organized_idea`
- `bridge_items` é a única fonte de catálogo

Saída obrigatória:
```json
{
  "status": "ok|fail|blocked",
  "task_id": "P0.1",
  "legacy_points_found": [],
  "legacy_points_active": [],
  "canonical_flow_valid": true,
  "actions_taken": [],
  "remaining_risk": ""
}
```

---

## TASK P0.2 — Resolver acesso operacional Supabase remoto

Objetivo:
Eliminar bloqueios de privilégio e confirmar operação remota repetível.

Passos:

1. executar:

   * `npx supabase migration list --linked`
   * `npx supabase functions list --project-ref uhzwqhaxnodtshlvvikt`
2. se houver 403:

   * validar `SUPABASE_ACCESS_TOKEN`
   * validar conta do token
   * validar acesso ao projeto
3. confirmar uso de Docker e bootstrap
4. repetir os comandos
5. registrar resultado final

Critério de sucesso:

* ambos os comandos retornam sucesso
* sem 403

Saída obrigatória:

```json
{
  "status": "ok|fail|blocked",
  "task_id": "P0.2",
  "migration_list_ok": false,
  "functions_list_ok": false,
  "had_403": false,
  "resolution": "",
  "final_state": ""
}
```

---

## TASK P0.3 — Remover segredo OpenAI do frontend — CONCLUÍDA (2026-05-09)

Estado: **fechada**. Não reabrir sem evidência objetiva de regressão (ex.: grep em `src/` retornando match novo de `VITE_OPENAI_API_KEY`).

Resolução registrada:

* chave antiga OpenAI revogada
* chave nova ativa apenas no backend Supabase
* `.env` local sem `VITE_OPENAI_API_KEY`
* `src/` com zero referências a `VITE_OPENAI_API_KEY` ou `OPENAI_API_KEY`
* segredo consumido apenas via `Deno.env.get('OPENAI_API_KEY')` em `supabase/functions/transcribe`, `organize` e `_shared/openai.ts`

Saída registrada (P0.3 final):

```json
{
  "status": "ok",
  "task_id": "P0.3",
  "references_found": [
    "supabase/functions/organize/index.ts",
    "supabase/functions/transcribe/index.ts",
    "supabase/functions/_shared/openai.ts"
  ],
  "references_removed": [
    "src/* (already clean)",
    ".env (already clean)"
  ],
  "frontend_clean": true,
  "build_ok": true,
  "closed_at": "2026-05-09"
}
```

---

# P1

## TASK P1.1 — Endurecer fluxo de auth em “Separar ideias”

Objetivo:
Garantir recuperação clara e consistente quando a sessão expira ou auth falha no pipeline de fila/notas.

Arquivos obrigatórios:

* `src/lib/functionAuth.ts`
* `src/services/serviceAuth.ts`
* `src/utils/captureQueueErrorMessage.ts`
* `src/pages/CaptureQueue.tsx`

Passos:

1. revisar caminho atual de refresh/retry
2. simular ou reproduzir cenário de sessão expirada
3. distinguir:

   * erro de auth
   * erro de infra
4. ajustar mensagem e comportamento para não gerar erro opaco
5. validar retry controlado
6. validar relogin/recovery quando necessário

Critério de sucesso:

* sessão expirada gera recuperação clara
* fila não entra em loop opaco
* logs distinguem auth vs infra

Saída obrigatória:

```json
{
  "status": "ok|fail|blocked",
  "task_id": "P1.1",
  "auth_recovery_ok": false,
  "looping_error_removed": false,
  "error_classification_ok": false,
  "changes_made": []
}
```

---

## TASK P1.2 — Validar ponta-a-ponta bridge com dados reais de safe_capture

Objetivo:
Comprovar o fluxo canônico real usando material elegível de `safe_capture`.

Pré-condição:

* seção 16 operacional
* schema remoto saudável
* functions publicadas

Passos:

1. gerar sessão real de `safe_capture`
2. materializar `note`
3. materializar `organized_idea`
4. garantir entrada em `bridge_items`
5. exportar com `export-to-cenax`
6. validar vínculo em `bridge_exports.bridge_item_id`
7. registrar payload e estados

Critério de sucesso:

* item elegível aparece em `bridge_items`
* export cria row em `bridge_exports`
* vínculo existe
* statuses coerentes

Saída obrigatória:

```json
{
  "status": "ok|fail|blocked",
  "task_id": "P1.2",
  "safe_capture_session_id": "",
  "note_bridge_item_id": "",
  "organized_idea_bridge_item_id": "",
  "bridge_export_ids": [],
  "linkage_ok": false,
  "final_statuses": {}
}
```

---

## TASK P1.3 — Fechar observabilidade mínima operacional

Objetivo:
Tornar incidentes de captura e bridge diagnosticáveis sem arqueologia manual.

Escopo:

* frontend
* edge functions
* bridge
* captura

Passos:

1. padronizar logs críticos
2. adicionar chaves de correlação quando possível:

   * `sessionId`
   * `chunkId`
   * `bridgeItemId`
   * `exportId`
3. revisar mensagens de erro
4. registrar runbook mínimo de incidente se necessário

Critério de sucesso:

* logs suficientes para diagnosticar falhas comuns
* correlação básica disponível
* sem ambiguidade grave no caminho bridge/captura

Saída obrigatória:

```json
{
  "status": "ok|fail|blocked",
  "task_id": "P1.3",
  "correlation_keys_added": [],
  "frontend_logs_updated": false,
  "function_logs_updated": false,
  "incident_diagnosable": false
}
```

---

# VALIDATION TASK GLOBAL

## TASK VALIDATION — Verificação operacional obrigatória

Objetivo:
Confirmar que o sistema está operacional após qualquer mudança relevante.

Passos:

1. executar a seção 16 de `VOICEIDEAS_CURRENT_STATE.md`
2. registrar resultados
3. se qualquer passo falhar, marcar sistema como não operacional

Critério de sucesso:

* todos os checks passam

Saída obrigatória:

```json
{
  "status": "operational|not_operational",
  "task_id": "VALIDATION",
  "migration_ok": false,
  "functions_ok": false,
  "bridge_items_ok": false,
  "export_ok": false,
  "notes": ""
}
```
