# VoiceIdeas Schema and API Reference

## 1) Tabelas centrais

## 1.1 `capture_sessions`
Papel: sessao de captura (origem da cadeia).

Campos principais:
- `id`
- `user_id`
- `started_at`
- `ended_at`
- `status` (`active|completed|cancelled|failed`)
- `processing_status` (`captured|awaiting-segmentation|...|ready|failed`)
- `platform_source` (`web|macos|android|ios`)
- `raw_storage_path`
- `provisional_folder_name`, `final_folder_name`, `rename_required`

## 1.2 `audio_chunks`
Papel: segmentos derivados da sessao.

Campos principais:
- `id`, `session_id`, `user_id`
- `storage_path`
- `start_ms`, `end_ms`, `duration_ms`
- `segmentation_reason`
- `queue_status`

## 1.3 `notes`
Papel: nota consolidada.

Campos de lineage:
- `source_capture_session_id`
- `source_audio_chunk_id`

## 1.4 `organized_ideas`
Papel: estrutura agregada de notas.

Campos principais:
- `id`, `user_id`
- `note_ids[]`
- `type`
- `title`
- `tags[]`
- `content` (JSON)

## 1.5 `bridge_items`
Papel: catalogo consultavel para destino externo.

Campos:
- identidade: `id`, `user_id`
- origem: `source_type`, `source_id`, `source_capture_session_id`, `source_session_mode`
- conteudo: `content_type`, `title`, `summary`, `content`, `payload`
- governanca: `validation_status`, `validation_issues`, `bridge_status`
- semantica: `destination_kind`, `destination_candidates`
- ciclo: `published_at`, `consumed_at`, `blocked_at`, `created_at`, `updated_at`

## 1.6 `bridge_exports`
Papel: historico de tentativas/envios/export.

Campos:
- `id`
- `content_type`
- `idea_draft_id` | `note_id` | `organized_idea_id`
- `bridge_item_id` (FK opcional para `bridge_items`)
- `destination`
- `payload`
- `status`
- `validation_status`, `validation_issues`
- `error`
- `exported_at`
- `created_at`, `updated_at`

## 1.7 `user_settings`
Papel: preferencia por usuario para integracoes.

Campos:
- `id`
- `user_id`
- `bardo_bridge_enabled`
- `created_at`, `updated_at`

## 2) Edge functions: contrato funcional

## 2.1 `bridge-items` (GET)
Arquivo: `supabase/functions/bridge-items/index.ts`

Auth:
- obrigatoria via JWT (manual auth por `_shared/auth.ts`).

Query params:
- `bridge_status`
- `validation_status`
- `destination_kind`
- `content_type`
- `limit` (default 50, max 200)
- `sync` (default ligado; `sync=0` desativa sync previo)

Resposta:
- `items[]`
- `count`
- `sync` (resumo de materializacao quando `sync` ativo)

## 2.2 `export-to-cenax` (POST)
Arquivo: `supabase/functions/export-to-cenax/index.ts`

Casos suportados:
- Novo fluxo bridge v1:
- `contentType=note` + `noteId`
- `contentType=organized_idea` + `organizedIdeaId`
- destino permitido nessa v1 de captura segura: `bardo`
- Fluxo legado (ainda existente):
- `ideaDraftId` para `contentType=idea_draft`

Campos de request:
- `destination`
- `contentType` (opcional, inferido por ids)
- `noteId` ou `organizedIdeaId` ou `ideaDraftId`
- `retry` (opcional)
- `validateOnly` (opcional)

Comportamento relevante:
- valida elegibilidade em `_shared/bridge-export.ts`
- sincroniza/cria `bridge_items`
- registra evento em `bridge_exports`
- envia payload para `BARDO_BRIDGE_URL`/`CENAX_BRIDGE_URL` quando configurado
- marca `bridge_item` como `published` em sucesso

## 2.3 `bridge-exports` (GET/POST, fluxo legado de consumo)
Arquivo: `supabase/functions/bridge-exports/index.ts`

Auth:
- `x-bridge-secret` (shared secret)

Funcoes:
- GET lista exports pendentes para email
- POST marca imported/rejected via RPC

Atencao:
- arquivo ainda referencia shape legado (`owner_email`, `content_hash`) e deve ser tratado com cautela.

## 3) RPCs de marcacao de consumo/rejeicao
Migrations:
- `202604170002_bridge_mark_rpcs.sql`
- `202604170003_bridge_mark_rpcs_fix_exported_at.sql`

RPCs:
- `bridge_mark_imported(p_bridge_export_id uuid)`
- `bridge_mark_rejected(p_bridge_export_id uuid)`

Garantias:
- transacional
- lock em export/item
- idempotencia
- preservacao de terminal oposto (`consumed` nao vira `blocked` e vice-versa)
- guard de destino `bardo`

## 4) Contratos de payload (v1)

## 4.1 Envelope de export bridge
Tipo TS: `BridgeExportPayload` (frontend) / `BridgeExportEnvelope` (function shared)

Campos:
- `bridgeVersion: "voiceideas.bridge-export.v1"`
- `domain: "voiceideas"`
- `destination`
- `contentType`
- `contentId`
- `scopeType: "project"`
- `sourceSessionMode`
- `sourceSessionIds`
- `validationStatus`
- `validationIssues[]`
- `deliveryPayload`

## 4.2 Payload Bardo de entrega
Tipo TS: `BardoBridgePayload`

Campos:
- `schemaVersion: "voiceideas.bardo-bridge.v1"`
- `sourceApp: "voiceideas"`
- `targetApp: "bardo"`
- `locale`
- `preparedAt`
- `artifact` (id, type, title, summary, plainText, tags, folders, sections, metadata)

## 5) Gate de elegibilidade implementado (resumo)

### Nota (`resolveNoteBridgeExport`)
Bloqueia quando:
- nota sem `source_capture_session_id`
- sessao de origem ausente
- sessao nao concluida (`status != completed`)
- sessao sem `raw_storage_path` (sync ainda nao concluido)
- sessao/trecho com status de falha
- conteudo insuficiente

### Ideia organizada (`resolveOrganizedIdeaBridgeExport`)
Bloqueia quando:
- sem `note_ids`
- notas-fonte faltantes
- alguma nota-fonte inelegivel pela regra acima
- estrutura de `content.sections` insuficiente

## 6) Query de verificacao util (manual)
```sql
select
  bi.id as bridge_item_id,
  bi.source_type,
  bi.source_id,
  bi.bridge_status,
  bi.validation_status,
  bi.destination_kind,
  be.id as bridge_export_id,
  be.status as export_status,
  be.destination,
  be.exported_at
from public.bridge_items bi
left join public.bridge_exports be on be.bridge_item_id = bi.id
where bi.user_id = auth.uid()
order by bi.created_at desc;
```

## 7) Decisao pratica para proxima equipe
Antes de qualquer evolucao, decidir explicitamente:
1. Qual endpoint sera o contrato oficial de consumo para Bardo.
2. Em que sprint o caminho legado sera removido.
3. Quais payloads passam a ser oficialmente suportados na v1.
