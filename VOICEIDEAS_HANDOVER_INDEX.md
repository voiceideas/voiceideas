# VoiceIdeas Handover Index (2026-04-17)

## 1) Objetivo deste pacote
Este pacote foi escrito para permitir que outro time finalize o VoiceIdeas sem depender de contexto oral, historico de chat, ou memoria de quem implementou as fases anteriores.

Foco: entregar uma visao operacional real do sistema atual, com o que esta pronto, o que esta parcial, o que esta legado, e exatamente o que falta para concluir.

## 2) Estado atual resumido
- O app roda em web + Android + iOS (Capacitor), com frontend React + Vite.
- A captura segura Android ja tem base nativa real:
- Foreground Service
- plugin Capacitor proprio (`SecureCapture`)
- sessao persistida em disco
- chunking local WAV
- recuperacao honesta de estado via manifesto
- Pipeline de captura no backend existe (`capture_sessions`, `audio_chunks`, `transcription_jobs`, `idea_drafts` etc).
- Bridge para Bardo ja tem base v1 em duas camadas:
- `bridge_items` (catalogo consultavel)
- `bridge_exports` (log de tentativas/envios)
- Existe divergencia entre caminho bridge canonico novo e caminho legado antigo (detalhado nos docs abaixo).

## 3) Leitura recomendada (ordem)
1. `VOICEIDEAS_SYSTEM_ARCHITECTURE.md`
2. `VOICEIDEAS_SUPABASE_BACKEND_RUNBOOK.md`
3. `VOICEIDEAS_ANDROID_SECURE_CAPTURE_RUNBOOK.md`
4. `VOICEIDEAS_COMPLETION_BACKLOG.md`

## 4) Comeco rapido para quem assumir (primeiras 2h)
1. Ler este arquivo inteiro.
2. Ler os 4 docs acima na ordem.
3. Subir ambiente local com Docker (ver `DOCKER_SETUP.md` e runbook).
4. Rodar build/lint local:
- `npm run docker:lint`
- `npm run docker:build`
5. Validar app web local e login.
6. Validar fila de captura e fluxo basico de bridge no frontend.
7. Validar acesso Supabase CLI (se der 403, ver troubleshooting no runbook).
8. Confirmar se o time vai seguir o caminho bridge canonico e aposentar o legado.

## 5) Regras de continuidade (nao quebrar)
- Nao prometer captura continua no iOS com tela bloqueada (nao implementado).
- Nao tratar `bridge_exports` como catalogo.
- Nao tratar `bridge_items` como log de eventos.
- Nao usar estado React como fonte de verdade para sessao Android.
- Nao abrir escopo de semantica bridge alem de v1 minima sem decisao explicita.

## 6) Pontos de risco ativos
- Divergencia entre codigo bridge novo vs legado (frontend + edge function legado).
- Dependencia de permissoes de conta para operar Supabase remoto (CLI pode retornar 403).
- Arquivos nao rastreados no repo (icones iOS e migration de reconciliacao) exigem decisao antes de release.

> P0.3 (`VITE_OPENAI_API_KEY` no frontend) **fechado em 2026-05-09**: chave antiga revogada, chave nova só no backend, sem referencia runtime no cliente.

> A.2.VI / SYSFIX.LINK.1 (lado VI) **fechado em 2026-05-10**: EF `link-bardo-account` ACTIVE v2 com resposta superset (`ok`, `linked`, `link_status`), JWT VI obrigatório, `vi_user_id` derivado de `auth.uid()`, idempotente. `bridge-inbox` continua exigindo vínculo ativo (P1.3 preservado).

> VI_LINK.AUTO_ACCOUNT_LINK **fechado em 2026-05-10**: rota web pública `/connect-bardo` implementada (`src/pages/ConnectBardo.tsx`). Bardo redireciona o usuário para `/connect-bardo?bardo_user_id=...&bardo_email=...&return_url=...&state=...`; VI loga (se necessário) e chama `POST /link-bardo-account` com JWT VI. Callback ao Bardo só acontece se a `return_url` estiver no allowlist (`https://obardo.app`, `https://www.obardo.app`, localhost em DEV) — bloqueio de open-redirect via `src/lib/bardoCallback.ts`. Pendências operacionais (fora do VI): publicar deploy web do VI; configurar `VITE_VOICEIDEAS_WEB_URL` no Cloudflare do Bardo; validar E2E com usuário limpo; revogar `HOTFIX.LINK.1` (row `a5273c62-…`) só depois do E2E limpo.

> **VI_BRIDGE.FINAL_STATUS_CYCLE.1 — fechado em 2026-05-12**: ciclo completo VI ↔ Bardo validado E2E em produção. Cobre: envio (manual/contínuo/safe_capture/organized_idea), Inbox do Bardo, importação, rejeição, retorno de status pro VI, reenvio normal, reenvio com snapshot quando fonte sumiu, histórico preservado, prefs server-side, identidade visível no header. Bug do sync passivo rebaixando bridge_status corrigido (`SNAPSHOT_RESEND.INBOX_FIX`). EFs finais: export-to-cenax v9, bridge-items v6, bridge-exports v6, link-bardo-account v2, bridge-identity-check v2. **A ponte não bloqueia mais empacotamento.** Próximo bloco: desktop/Android/iOS release readiness. Cleanup pendente (não bloqueia): revogação do HOTFIX.LINK.1 (`a5273c62-…`).

## 7) Glossario rapido
- Safe Capture: modo de captura com preservacao de sessao/audio para pipeline seguro.
- Bridge Item: item catalogado, elegivel/consultavel para consumo do Bardo.
- Bridge Export: tentativa/envio de exportacao para destino externo.
- Canonico backend: verdade operacional persistida no Supabase.
- Legado bridge: fluxo antigo baseado em `owner_email/content_hash` e modal manual.

## 8) Onde continuar o trabalho
Todo o plano pratico de finalizacao esta em `VOICEIDEAS_COMPLETION_BACKLOG.md`, com ordem, criterios de aceite e validacoes.

## Operação com Claude
- `CLAUDE_OPERATOR_GUIDE.md`
- `VOICEIDEAS_TASKS.md`
