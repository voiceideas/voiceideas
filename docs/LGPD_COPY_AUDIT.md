# LGPD Copy Audit — VoiceIdeas

> Auditoria objetiva das mensagens visíveis ao usuário relacionadas a
> privacidade, retenção de dados, transcrição por IA e compartilhamento.
>
> Cada item lista: **onde aparece**, **o que diz hoje**, **se confere
> com a realidade técnica**, **decisão (manter / ajustar / criar)**.
>
> Versão: 1.0 · Data: 2026-05-17 · Ordem: `VI_LGPD_UNIFICATION`

---

## 1. Textos auditados

### 1.1 Áudio retido — promessa "30 dias" (CRÍTICO)

| Onde | i18n key | Texto pt-BR atual | Confere? |
|---|---|---|---|
| Recorder, hint do toggle "Salvar áudio" | `recorder.manual.retainAudio.hintEnabled` | "Áudio fica disponível por 30 dias." | ❌ **NÃO** — não há TTL real; áudio persiste indefinidamente |
| Recorder, bloco do player pós-gravação | `recorder.manual.retainAudio.expiryNotice` | "Áudio disponível por 30 dias após a gravação." | ❌ **NÃO** — idem |

**Diagnóstico:** copy prometia deleção automática que nunca foi implementada. Decisão da ordem `VI_LGPD_UNIFICATION` §6: **NÃO prometer deleção automática se ela não existe**.

**Ajuste aplicado nesta task:**

| Chave | Novo texto pt-BR (mais honesto) |
|---|---|
| `recorder.manual.retainAudio.hintEnabled` | "Áudio fica salvo na sua conta. Você pode excluir quando quiser." |
| `recorder.manual.retainAudio.expiryNotice` | "Áudio fica salvo na sua conta privada. Use 'Excluir' para remover." |

Versões en/es aplicadas com mesma semântica honesta.

### 1.2 Modo Manual — disclosure de envio ao servidor

| Onde | i18n key | Texto pt-BR atual | Confere? |
|---|---|---|---|
| Recorder, hint abaixo do mic Manual | `recorder.manual.deviceHint` | "Manual grava aqui dentro do VoiceIdeas e envia o áudio para transcrição no servidor." | ✅ confere — é exatamente o que acontece (VI_WEB_MANUAL_ENGINE_NO_SYSTEM_RECORDER) |

**Decisão:** manter. Texto já é honesto pós-VI_WEB_MANUAL_ENGINE.

**Sugestão futura (não aplicada nesta task):** complementar com link "Saiba mais sobre privacidade" → Privacy Policy. Aguarda próxima ordem que crie a página/modal.

### 1.3 Banner de fallback de upload (E3)

| Onde | i18n key | Texto pt-BR atual | Confere? |
|---|---|---|---|
| Banner amber pós-stop Manual+retain quando upload falha | `recorder.manual.retainAudio.audioFallbackBanner` | "Nota salva, mas o áudio não pôde ser arquivado desta vez. Tente novamente se quiser salvar o áudio." | ✅ confere |

**Decisão:** manter.

### 1.4 Settings — Account Card

| Onde | Texto pt-BR atual | Confere? |
|---|---|---|
| `SignedInAccountCard.tsx:70-85` | mostra email + UUID parcial do usuário | ✅ confere |
| `SignedInAccountCard.tsx:99-116` | mostra email Bardo + `linked_at` se vinculado | ✅ confere |

**Decisão:** manter o que já existe. **Gap:** falta botão "Desvincular Bardo" (existe no DB como `link_status='revoked'` mas sem UI). Não corrigido nesta task — fica como gap.

### 1.5 Bardo export — bridge

| Onde | i18n key | Texto pt-BR atual | Confere? |
|---|---|---|---|
| Bardo export modal | (várias chaves `recorder.bardo.*`) | descrevem payload "title, text, origin, tags, source notes" | ✅ confere |

**Decisão:** manter. Disclosure de payload já está adequado (usuário sabe o que vai).

### 1.6 Sem privacy policy / termos no app

**Gap:**
- ❌ Não há link "Política de Privacidade" em lugar algum (login, settings, footer).
- ❌ Não há link "Termos de Uso".
- ❌ Não há modal de consentimento no primeiro uso.

**Decisão:** criar `docs/PRIVACY_POLICY_DRAFT.md` para revisão jurídica/Gian. **Não publicar link na UI** nesta task — aguarda revisão e ordem específica de UI.

### 1.7 Login / Onboarding

| Onde | Texto pt-BR atual | Diagnóstico |
|---|---|---|
| Tela de login | "Capture suas ideias por voz e organize com IA" + email + magic link + Google | sem menção a privacidade, sem checkbox de termos |
| Magic link email | enviado pelo Supabase Auth (template padrão) | template Supabase, não personalizado |

**Decisão:** sem ajustes nesta task. **Gap:** falta linha discreta na tela de login do tipo "Ao entrar você aceita nossos termos de uso e política de privacidade" com links. Não aplicado — aguarda decisão sobre onde hospedar a Política.

### 1.8 Logout / "Sair"

| Onde | i18n key | Texto pt-BR atual | Diagnóstico |
|---|---|---|---|
| Header menu | `layout.signOut` | "Sair" | ✅ confere — apenas logout de sessão, não apaga dados |

**Gap:** "Sair" não tem disclosure de "seus dados continuam na conta". User pode confundir logout com exclusão. Não ajustado nesta task — copy curta tradicional não requer expansão. Eventualmente um modal de confirm pode esclarecer.

### 1.9 Mensagens de erro de transcrição

Verificadas em `useAudioTranscription.ts` e `createCaptureEngine.ts`:
- "Permita o uso do microfone para gravar sua ideia." ✅
- "Nenhum microfone foi encontrado neste aparelho." ✅
- "Sua sessao expirou. Entre novamente para continuar transcrevendo audio." ✅
- "Voce atingiu o limite diario desta transcricao..." ✅
- "Esse audio ficou grande demais para a transcricao rapida..." ✅
- "Nao foi possivel entender o audio gravado." ✅

**Decisão:** manter — nenhuma menciona dados pessoais indevidamente.

### 1.10 Logs e debug

Verificado em §5 do `LGPD_DATA_MAP.md` — logs (`security_events`, edge function `console.error`) **NÃO contêm**:
- transcript completo
- signed URLs com token
- áudio
- email
- senha (não há)

`metadata` JSONB em `security_events` contém `mimeType`, `fileSize`, `provider`, `latencyMs`, `transcriptLength` — todos não-sensíveis.

**Decisão:** manter. Logger wrapper (`src/lib/log.ts`) e edge functions já respeitam guardrails de não-logar dados sensíveis.

---

## 2. Cópias aplicadas nesta task (i18n)

### 2.1 pt-BR (`src/lib/i18nMessages.ts` ~linha 348-356)

```diff
- 'recorder.manual.retainAudio.hintEnabled': 'Áudio fica disponível por 30 dias.',
+ 'recorder.manual.retainAudio.hintEnabled':
+   'Áudio fica salvo na sua conta. Você pode excluir quando quiser.',

- 'recorder.manual.retainAudio.expiryNotice': 'Áudio disponível por 30 dias após a gravação.',
+ 'recorder.manual.retainAudio.expiryNotice':
+   'Áudio fica salvo na sua conta privada. Use a opção "Excluir" para remover.',
```

### 2.2 en (~linha 1077-1080)

```diff
- 'recorder.manual.retainAudio.hintEnabled': 'Audio stays available for 30 days.',
+ 'recorder.manual.retainAudio.hintEnabled':
+   'Audio is stored in your account. You can delete it whenever you want.',

- 'recorder.manual.retainAudio.expiryNotice': 'Audio available for 30 days after recording.',
+ 'recorder.manual.retainAudio.expiryNotice':
+   'Audio stays in your private account. Use "Delete" to remove it.',
```

### 2.3 es (~linha 1799-1803)

```diff
- 'recorder.manual.retainAudio.hintEnabled': 'El audio queda disponible por 30 días.',
+ 'recorder.manual.retainAudio.hintEnabled':
+   'El audio queda guardado en tu cuenta. Puedes eliminarlo cuando quieras.',

- 'recorder.manual.retainAudio.expiryNotice': 'Audio disponible por 30 días después de la grabación.',
+ 'recorder.manual.retainAudio.expiryNotice':
+   'El audio queda en tu cuenta privada. Usa "Eliminar" para borrarlo.',
```

---

## 3. Sem ajuste nesta task (gaps documentados)

| Gap | Razão de não corrigir agora |
|---|---|
| Botão "Apagar conta" na UI | exige edge function `/delete-account` + cascade explícito + UX modal de confirmação dupla — fora do escopo "ajustes seguros de i18n/copy". |
| Botão "Desvincular Bardo" | exige consenso com lado Bardo (handshake de revogação) — não mexer no Bardo per guardrail. |
| Link "Política de Privacidade" na UI | aguarda revisão do draft (`PRIVACY_POLICY_DRAFT.md`) por Gian. |
| Link "Termos de Uso" | mesmo motivo. |
| Modal de consentimento no primeiro uso | fora do escopo cirúrgico desta task; envolve onboarding redesign. |
| Disclosure de OpenAI no recorder | considerado mas decidido NÃO adicionar agora (Política de Privacidade pública cobrirá; adicionar no recorder seria ruído na UX principal). |
| TTL real de áudio | per guardrail explícito da ordem: "Não mexer em TTL/lifecycle real nesta etapa". |
| Cleanup de `security_events` / `ai_usage_ledger` | idem — sem migration nesta task. |
| Export "meus dados" estruturado | exige edge function dedicada + UX — fora do escopo. |

---

## 4. Decisões de tom

Padronizado para todas as copies novas:

- **pt-BR primeiro**; en/es seguem semântica.
- **Curto** — máximo ~12-15 palavras por mensagem informativa.
- **Operacional** — diz o que o user pode fazer ("Você pode excluir quando quiser") em vez de promessa institucional ("Garantimos privacidade").
- **Sem termo jurídico inflado** — evita "compliance", "garantia LGPD", "100% seguro".
- **Sem promessa de deleção automática** quando ela não existe.

---

## 5. Inventário i18n após task

Total de chaves relacionadas a privacidade/áudio/dados (ajustadas):
- `recorder.manual.retainAudio.hintEnabled` ✅ ajustada
- `recorder.manual.retainAudio.expiryNotice` ✅ ajustada

Total de chaves relacionadas mantidas como estão:
- `recorder.manual.deviceHint` ✅ mantida (já honesta pós-VI_WEB_MANUAL_ENGINE)
- `recorder.manual.retainAudio.label`, `playAudio`, `preparingPlayer`, `playerError`, `hintDisabled`, `audioFallbackBanner` ✅ mantidas
- `recorder.manual.status.unavailable` ✅ mantida
- Erros do hook legacy (`useAudioTranscription`) ✅ mantidos

Nenhuma chave nova adicionada. Paridade pt/en/es preservada para os ajustes.
