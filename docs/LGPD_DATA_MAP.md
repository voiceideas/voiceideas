# LGPD Data Map — VoiceIdeas

> Inventário objetivo de dados pessoais tratados pelo VoiceIdeas.
> Documento de **referência técnica interna** — não substitui Política
> de Privacidade pública (ver `PRIVACY_POLICY_DRAFT.md`).
>
> Versão: 1.0 · Data: 2026-05-17 · Ordem: `VI_LGPD_UNIFICATION`

---

## 1. Categorias de dados tratados

### 1.1 Dados de conta (identificação + autenticação)

| Campo | Origem | Onde está | Finalidade | Base legal |
|---|---|---|---|---|
| `email` | usuário (login) | `auth.users` (Supabase Auth) | autenticação, login mágico, recuperação | execução de contrato |
| `user_id` (UUID) | gerado | `auth.users.id` referenciado em todas as tabelas user-scoped | chave primária do titular | execução de contrato |
| sessão JWT | Supabase Auth | localStorage `sb-<project>-auth-token` (client) | manter sessão ativa | execução de contrato |
| `created_at` | gerado | `auth.users.created_at` | auditoria | legítimo interesse (audit) |

**Provider externo:** Supabase Auth (gerencia tokens, refresh, magic links). Política do provider: https://supabase.com/privacy

### 1.2 Conteúdo gerado pelo usuário

| Campo | Origem | Onde está | Finalidade | Base legal |
|---|---|---|---|---|
| `raw_text` (transcrição) | usuário (fala → Whisper) | `notes.raw_text` | exibir nota, organizar | execução de contrato |
| `title` | usuário (digitado ou auto) | `notes.title` | identificar nota | execução de contrato |
| `audio_chunks` (áudio comprimido) | usuário (mic) | bucket `voice-captures/{user_id}/sessions/{session_id}/chunks/{chunk_id}.{ext}` | playback opt-in, debugging, reprocessamento | consentimento (toggle "Salvar áudio") |
| `capture_sessions` (metadados de sessão) | gerado pelo engine | tabela `capture_sessions` | rastrear ciclo de gravação, status | execução de contrato |
| `idea_drafts` (textos limpos para org) | OpenAI gpt-4o-mini | tabela `idea_drafts` | gerar nota organizada via "Fazer mágica" | consentimento (ação explícita do usuário) |
| `organized_ideas` (notas estruturadas) | gerado por IA + edição | tabela `organized_ideas` | exibir nota organizada | execução de contrato |
| `folder_id`, `tags` | usuário | `notes.folder_id` + relação `note_tags` | organização | execução de contrato |

### 1.3 Metadados técnicos (logs + uso)

| Campo | Origem | Onde está | Finalidade | Retenção |
|---|---|---|---|---|
| `security_events` (auth attempts, transcribe calls) | edge functions | tabela `security_events` (user_id, event_type, ip, metadata) | auditoria de segurança, detecção de abuso | indefinida (sem cleanup automático — gap) |
| `ai_usage_ledger` (cost tracking) | edge functions | tabela `ai_usage_ledger` (user_id, route, cost_usd) | aplicar quota diária, billing audit | indefinida (gap) |
| `transcription_jobs` (status OpenAI) | transcribe function | tabela `transcription_jobs` | rastrear jobs ativos | indefinida (gap) |
| `ip` | extraído do Request | `security_events.ip` | rate limit, audit | indefinida (gap) |
| `mimeType`, `fileSize` | client upload | `security_events.metadata` JSONB | audit | indefinida (gap) |

### 1.4 Preferências locais (device-only)

| Chave localStorage | O que guarda | Onde fica |
|---|---|---|
| `voiceideas.recorder-ui-preferences.v1` | toggle "Salvar áudio", modo default Manual/Continuous/Safe, IDs de notas escondidas | client browser |
| `voiceideas.capture-engine.use-unified.v1` | feature flag rollback do engine | client browser |
| `voiceideas.language.v1` | idioma preferido (pt-BR/en/es) | client browser |
| `voiceideas.integrations.preferences.v1` | toggle Bardo integration | client browser |
| `voiceideas.voice-segmentation.v1` | parâmetros de segmentação | client browser |
| `voiceideas.native-auth.pending` | estado intermediário de OAuth redirect | client browser, limpo pós-auth |
| `sb-<project>-auth-token` | JWT da sessão Supabase | client browser |

**Nenhum cookie aplicacional usado.** Sessões são gerenciadas via JWT no `localStorage` (decisão arquitetural Supabase Auth).

### 1.5 Integrações externas (compartilhamento com terceiros)

| Provider | O que é enviado | Quando | Edge function | Política do provider |
|---|---|---|---|---|
| **OpenAI** (Whisper / gpt-4o-transcribe) | áudio bruto + idioma + prompt | a cada Manual stop | `/transcribe` | https://openai.com/policies/privacy-policy |
| **OpenAI** (gpt-4o-mini) | transcrição completa + prompt de organização | quando user clica "Fazer mágica" | `/organize` + `/materialize-idea` | idem |
| **Bardo / CENAX** | `title`, `text`, `tags`, `source_notes`, `bardo_email` | quando user dispara export para Bardo | `/export-to-cenax`, `/link-bardo-account` | Política Bardo (separada — gerida por outro produto Capitolio) |
| **Supabase** | tudo (auth + DB + storage) | infraestrutura | n/a | https://supabase.com/privacy |
| **Vercel** | hospedagem do front-end web (assets estáticos + edge runtime) | sempre | n/a | https://vercel.com/legal/privacy-policy |
| **Apple / Google** | distribuição do app nativo (iOS App Store / Google Play) | quando user instala app | n/a | políticas de loja |

**Importante:** o áudio é enviado para OpenAI mesmo quando o user NÃO ativa "Salvar áudio". A diferença é onde o áudio fica DEPOIS da transcrição:
- Toggle OFF → áudio fica apenas em memória do client; OpenAI recebe para transcrever; VoiceIdeas não persiste.
- Toggle ON → mesmo fluxo + upload para bucket `voice-captures` para playback opcional.

---

## 2. Storage buckets

| Bucket | Conteúdo | Acesso |
|---|---|---|
| `voice-captures` | áudio bruto opt-in (Manual+retain) + áudio Safe Capture | privado (RLS — apenas owner via signed URL com TTL 1h) |

**Path schema:** `{userId}/sessions/{sessionId}/chunks/{chunkId}.{ext}`

**Sem lifecycle rule de TTL automático.** Áudio persiste indefinidamente até o usuário deletar manualmente (via UI ou edge function `/delete-audio-chunk` / `/delete-capture-session`).

---

## 3. Operações de exclusão disponíveis

| O que o usuário pode apagar | Como | Implementação | Cascateia? |
|---|---|---|---|
| Nota individual | botão delete na UI | `DELETE` em `notes` | sim → `note_tags`, `note_folders` |
| Sessão de captura (áudio + nota + segmentos) | edge function `/delete-capture-session` | bulk delete | sim → `audio_chunks`, `transcription_jobs`, `idea_drafts`, objeto no bucket |
| Chunk de áudio individual | edge function `/delete-audio-chunk` | delete da row + delete do objeto storage | parcial |
| Tags / Pastas | UI | DELETE direto | desfaz vínculo |

**Não disponível hoje:**
- **Exclusão de conta** (right to be forgotten / LGPD art. 18 VI). User não tem botão "apagar minha conta" na UI. Tecnicamente, deletar `auth.users.{id}` cascateia para todas as tabelas user-scoped via `ON DELETE CASCADE`, mas não há fluxo UI nem edge function que execute isso.
- **Exclusão de logs de segurança** (`security_events`, `ai_usage_ledger`). Esses dados permanecem mesmo após user deletar conta (deveriam ser anonimizados ou removidos).
- **Exclusão do vínculo Bardo** (`bardo_account_links`). Existe `link_status: 'revoked'` mas não há UI pra usuário acionar.

---

## 4. Retenção (estado atual)

| Tipo de dado | Promessa UI | Política operacional real |
|---|---|---|
| Áudio bruto (opt-in retain) | "Áudio disponível por 30 dias" (i18n key `expiryNotice`) | **NENHUMA. Áudio persiste indefinidamente.** |
| Notas | nenhuma promessa | indefinida até user apagar |
| Logs de segurança | nenhuma | indefinida (gap) |
| Quota de IA | nenhuma | row por dia, agregada |
| Convites compartilhamento | `expires_at = now() + 30 days` (DB DEFAULT) | sim — token expira via comparação `now() < expires_at` |

**Gap crítico identificado:** UI promete "30 dias" para áudio mas não há TTL real. Ver §6 do `LGPD_COPY_AUDIT.md` para ajuste de copy.

---

## 5. Logs e dados sensíveis

### O que é logado

`security_events` registra:
- `user_id` (UUID)
- `event_type` (ex: `legacy_transcribe_call`)
- `ip` (extraído do Request)
- `metadata` JSONB (varia por evento: `language`, `mimeType`, `fileSize`, `provider`, `model`, `transcriptionMode`, `transcriptLength`, `audioPersisted`, `audioStorageError.code`, `latencyMs`, `estimatedCostUsd`)

### O que NÃO é logado (verificado)

- ✅ Transcript completo (apenas `transcriptLength` numérica)
- ✅ Signed URLs (apenas `storage_path` em audit, sem token)
- ✅ Token JWT
- ✅ Email (logs internos não persistem email)
- ✅ Áudio bruto
- ✅ Senha (não há password — apenas magic link / OAuth)

---

## 6. Bases legais (mapeamento LGPD art. 7)

| Tratamento | Base legal LGPD |
|---|---|
| Auth + manter sessão | art. 7 V (execução de contrato) |
| Salvar nota digitada/transcrita | art. 7 V (execução de contrato) |
| Enviar áudio para OpenAI transcrever | art. 7 V (execução de contrato — função essencial do produto) |
| Salvar áudio retido (opt-in toggle) | art. 7 I (consentimento do titular) |
| "Fazer mágica" / organize via IA | art. 7 V (execução de contrato — ação explícita do user dispara) |
| Exportar para Bardo | art. 7 V (consentimento manifestado pela ação de export) |
| Logs de segurança / quota | art. 7 IX (legítimo interesse — segurança operacional) |
| Métricas de uso (cost tracking) | art. 7 IX (legítimo interesse — billing audit) |

---

## 7. Direitos do titular (LGPD art. 18) — estado atual

| Direito | Status |
|---|---|
| Confirmação da existência de tratamento | ⚠️ informal (user vê dados na UI mas não há tela dedicada de "meus dados") |
| Acesso aos dados | ⚠️ parcial (vê nota + áudio retido; não vê logs `security_events`) |
| Correção de dados incompletos/inexatos | ✅ via UI (edita nota, transcript) |
| Anonimização, bloqueio, eliminação | ⚠️ parcial — apaga nota/sessão mas não logs nem conta inteira |
| Portabilidade | ❌ não há export de "meus dados" em formato estruturado |
| Eliminação dos dados tratados com consentimento | ❌ falta UI de "apagar conta" |
| Informação sobre compartilhamento | ⚠️ parcial — Bardo é visível em Settings; OpenAI não é mencionado em UI |
| Informação sobre não fornecer consentimento | ⚠️ implícito (toggle de áudio) |
| Revogação do consentimento | ⚠️ parcial — toggle ON→OFF para futuro retain; áudio já gravado não é apagado automaticamente |

---

## 8. Resumo de gaps técnicos (para próximas ordens)

1. **Sem TTL real de áudio.** Copy promete 30 dias; implementação ausente.
2. **Sem fluxo de exclusão de conta.** Edge function inexistente, UI inexistente.
3. **Sem export "meus dados" estruturado** (LGPD art. 18 V — portabilidade).
4. **Sem cleanup de logs** (`security_events`, `ai_usage_ledger`).
5. **Sem disclosure de OpenAI** na UI (modal de privacidade no recorder ou onboarding).
6. **Sem privacy policy** acessível na UI (link no rodapé/menu).
7. **Sem termos de uso** acessível na UI.
8. **Bardo email linkage sem revoke UI** (existe `link_status='revoked'` na DB mas não há botão).

Ver `LGPD_COPY_AUDIT.md` para análise de copy e ajustes seguros aplicados nesta task. Ver `PRIVACY_POLICY_DRAFT.md` para texto público draft.
