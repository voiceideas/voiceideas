# VoiceIdeas

Aplicacao de captura de ideias com pipeline de audio, organizacao e bridge para destinos externos (Bardo/Cenax), com suporte web + Android + iOS via Capacitor.

## Documentacao de handover (leitura obrigatoria)
- `VOICEIDEAS_HANDOVER_INDEX.md`
- `VOICEIDEAS_SYSTEM_ARCHITECTURE.md`
- `VOICEIDEAS_SUPABASE_BACKEND_RUNBOOK.md`
- `VOICEIDEAS_ANDROID_SECURE_CAPTURE_RUNBOOK.md`
- `VOICEIDEAS_SCHEMA_AND_API_REFERENCE.md`
- `VOICEIDEAS_COMPLETION_BACKLOG.md`

## Scripts principais
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run android:sync`
- `npm run docker:shell`
- `npm run docker:build`
- `npm run docker:lint`

## Setup operacional existente
- Docker: `DOCKER_SETUP.md`
- Supabase: `SUPABASE_SETUP.md`
- Android build: `ANDROID_BUILD.md`
- iOS build: `IOS_BUILD.md`

## Observacao importante
O README antigo de template Vite foi substituido por este resumo porque o projeto ja nao e um template inicial e exige contexto operacional especifico para continuidade.

## Bridge: Legacy vs Canonical
Novos fluxos de export devem usar APENAS o caminho canônico.

### Caminho canônico (obrigatório para código novo)
- Service frontend: [`src/services/bridgeExportService.ts`](src/services/bridgeExportService.ts) — `exportBridgeContent`, `validateBridgeContent`, `exportIdeaDraft`.
- UI: [`src/components/SafeCaptureBridgeExportPanel.tsx`](src/components/SafeCaptureBridgeExportPanel.tsx) → renderizada em [`src/components/NoteCard.tsx`](src/components/NoteCard.tsx) e [`src/components/OrganizedView.tsx`](src/components/OrganizedView.tsx).
- Edge function: [`supabase/functions/export-to-cenax/index.ts`](supabase/functions/export-to-cenax/index.ts).
- Catálogo: [`supabase/functions/bridge-items/index.ts`](supabase/functions/bridge-items/index.ts) + tabela `bridge_items`.

### Caminho legado (isolado, dead-code em UI, endpoint mantido)
- [`src/lib/bridgeExport.ts`](src/lib/bridgeExport.ts) `sendToBardo()` — INSERT direto em `bridge_exports` com schema v1 (`owner_email` + `content_hash`). Chamador único: [`src/components/SendToBardoModal.tsx`](src/components/SendToBardoModal.tsx), que por sua vez **não é importado por nenhuma tela ativa** (grep confirma zero montagens).
- [`src/hooks/useBridgeExport.ts`](src/hooks/useBridgeExport.ts) — hook definido mas sem consumidor.
- [`supabase/functions/bridge-exports/index.ts`](supabase/functions/bridge-exports/index.ts) — endpoint de CONSUMO pelo Bardo via `x-bridge-secret`, mantido porque a integração antiga do Bardo ainda faz polling.

### Regra
- **Código novo** → sempre `bridgeExportService` + `export-to-cenax`.
- **Legado** → marcado com banner `LEGACY BRIDGE PATH — NÃO USAR PARA NOVOS FLUXOS`, preservado em produção até unificação explícita ser autorizada.
- Risco real de dupla escrita: **mitigado** — UI do frontend não tem caminho para invocar `sendToBardo`, então a única fonte de escrita atual é a canônica. O schema dual em `bridge_exports` permanece por compatibilidade com o consumidor Bardo.
- Ver `VOICEIDEAS_CURRENT_STATE.md` §4.
