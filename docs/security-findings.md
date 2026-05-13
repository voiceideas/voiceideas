# Security findings — VoiceIdeas

Registro vivo das auditorias de segurança. Cada entrada cobre um diff
específico (commit range), classifica achados e propõe correção
mínima quando severidade é `critical` ou `high`.

---

## Audit 2026-05-12 — diff `a665500..7495817` (release v0.1.0 + i18n sweeps)

**Escopo:** 7 commits, 18 arquivos, 2538 inserções / 223 deleções.
Predominantemente refactor de i18n + release docs. Única mudança
substantiva de lógica foi a supressão de erros locale-aware em
`AcceptInvite.tsx` e `ShareIdeaModal.tsx`.

**Baseline tooling:** `npm run security:test` (check-jwt +
check-surface) — verde. 15 functions autenticadas verificadas
self-managed-auth; superfícies client/server hardened em organize,
transcribe, sharing.

**Auditor:** subagente security-reviewer (cross-ref com edge
functions, services, hooks, RLS migrations).

### Resumo

| Severidade | Quantidade |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 2 |

**Veredito:** Sem issues exploráveis críticos/altos. As mudanças são
predominantemente refactor de catálogo i18n. O único delta de lógica
(supressão locale-aware de erros backend) não abre buraco mas degrada
UX de erro para usuários en/es — recomendado migrar para error-code
estruturado no backend.

---

### F1 — Locale-aware error suppression hides actionable backend errors

* **Severidade:** low
* **Categoria:** Security Misconfiguration / UX-as-security
* **Arquivos:**
  - `src/pages/AcceptInvite.tsx`:126, 159, 169, 182
  - `src/components/ShareIdeaModal.tsx`:97-98
* **Evidência:**
  ```js
  // AcceptInvite.tsx:126
  setError(locale === 'pt-BR' ? rawMessage : t('invite.error.acceptFailed'))
  ```
* **Explicação:** Quando locale ≠ pt-BR, qualquer erro do backend
  colapsa em uma mensagem genérica. Estados distintos como "Token
  expirado", "Convite revogado", "Rate limit excedido", "Email já em
  uso", "Conta bloqueada" todos viram o mesmo "Could not accept
  invite". Usuários en/es perdem sinal sobre se devem retry, pedir
  novo convite ou contatar suporte. Não é falha clássica de segurança
  — é degradação de UX de erro com impacto em capacidade de
  diagnóstico.
* **Correção recomendada:** Migrar edge functions
  (`accept-idea-invite`, `preview-idea-invite`, `share-idea`,
  `link-bardo-account`) para retornar `{ error: string, error_code:
  'invite_expired' | 'invite_revoked' | 'email_mismatch' | ... }`.
  Cliente switch-case no `error_code` e renderiza string traduzida do
  catálogo. Out-of-scope desta task de release (mudaria edge
  functions); endereçar em sweep seguinte de bridge UX.
* **Status:** open (não bloqueia release)

---

### F2 — Self-attestation de `bardo_user_id` permite Bardo identity confusion (cross-system)

* **Severidade:** low (info se Bardo valida no consume)
* **Categoria:** Broken Authentication / Identity Spoofing (cross-service)
* **Arquivos:**
  - `src/components/BardoConnectionToggle.tsx`:142-150
  - `supabase/functions/link-bardo-account/index.ts`:150-160
* **Evidência:**
  ```jsx
  <input
    type="text"
    value={bardoUserId}
    onChange={(e) => setBardoUserId(e.target.value)}
    placeholder={t('bardoConnection.bardoIdPlaceholder')}
  />
  ```
* **Explicação:** O fluxo aceita qualquer string como
  `bardo_user_id` e persiste como vínculo canônico. Não há challenge
  provando que o usuário VI realmente é dono da conta Bardo
  reivindicada. Um usuário VI malicioso poderia vincular sua conta VI
  ao `bardo_user_id` de outra pessoa, fazendo notas que ele cria em
  VI caírem no Inbox Bardo da vítima. Dentro do VoiceIdeas isso não é
  vazamento (o atacante envia seus próprios dados). Impacto fica
  inteiramente no consumidor Bardo. Design documentado
  (`bardo_email` é snapshot de auditoria — não autoriza nada).
* **Correção recomendada:** Out of scope VoiceIdeas. Garantir lado
  Bardo que `bridge-exports` consumer valide que o `bardo_user_id`
  vinculado corresponde à conta destinatária Bardo antes de importar.
  Documentar expectativa em `link-bardo-account/index.ts`.
  Alternativamente, substituir self-attestation por handshake OAuth
  onde Bardo emite bind-token de curta duração.
* **Status:** **resolved (2026-05-13)** — `VI_BARDO.IDENTITY_LINK_HARDENING.R3_CONSUME_BARDO_NONCE`
  implementou o handshake server-side: Bardo emite `bridge_nonce` one-time
  (TTL 5min, single-use) via `bridge-link-issue-nonce`; VI calcula
  `vi_user_email_hash = sha256(BRIDGE_EMAIL_HASH_SALT + ':email:' +
  lower(vi.auth.email))` na edge function `link-bardo-account`, consome
  o nonce no Bardo (`bridge-link-consume-nonce`) com `x-bridge-secret`,
  e só cria vínculo se Bardo retornar `email_hash_match === true`.
  Cliente nunca informa `bardo_user_id`/`bardo_email` — vêm da resposta
  do Bardo após match criptográfico. A row anômala `2e266f5b` (cross-link
  count4all VI → conactseculo21 Bardo) foi automaticamente **revogada
  em produção em 2026-05-13 15:33:57** pelo próprio mecanismo do R3
  durante o smoke `valid_nonce_same_email`: a regra "uma conta Bardo
  por vez por usuário VI" revogou o vínculo conflitante antes de criar
  o novo vínculo verificado (`09936f4b`: count4all VI → count4all
  Bardo). Sem ação manual, sem migration. Audit log estruturado
  registra `event: link_attempt, result: valid`.

---

### F3 — Stack trace / DB error leak via `getErrorMessage` em Admin panel

* **Severidade:** info
* **Categoria:** Information Disclosure
* **Arquivos:**
  - `src/pages/Admin.tsx`:53, 68
  - `src/hooks/useAdminUsers.ts`:103, 118
* **Evidência:**
  ```js
  // useAdminUsers.ts:103
  if (updateError) throw new Error(updateError.message)
  ```
* **Explicação:** Erros do Supabase (nomes de constraints PG, frases
  RLS como "new row violates row-level security policy", nomes de
  funções) propagam verbatim para o banner de feedback do Admin.
  Audiência é pequena (só admins chegam aqui, gated por `isAdmin` +
  RLS), mas mensagens podem revelar metadata de schema útil a
  atacante que já tem credenciais admin. Não-explorável por si.
* **Correção recomendada:** Em `useAdminUsers.ts:103, 118`,
  sanitizar mensagens: log full server-side, surface apenas
  string/código estável client-side. Ou strip Supabase metadata
  (`code`, `details`, `hint`) antes de re-throw.
* **Status:** open (defer)

---

### F4 — `bardo_user_id` completo renderizado em DOM (sem truncar)

* **Severidade:** info
* **Categoria:** Information Disclosure
* **Arquivos:**
  - `src/components/BardoConnectionToggle.tsx`:193-194
* **Evidência:**
  ```jsx
  {displayedEnabled && link?.bardo_user_id && (
    <p className="text-[11px] text-gray-500">
      {t('bardoConnection.linkedIdPrefix')}{' '}
      <code className="rounded bg-gray-100 px-1">{link.bardo_user_id}</code>
    </p>
  )}
  ```
* **Explicação:** Bardo user ID completo no DOM — visível em
  screenshots, shoulder surfing, bug-report tools, error monitoring
  SDKs que capturam snapshot do DOM. `SignedInAccountCard.tsx`
  trunca corretamente (`slice(0, 8)`), `BardoConnectionToggle` não.
  Tratamento inconsistente. Documentado como opaco/non-secret hoje,
  mas se formato vier a conter tokens identificadores, vira
  preocupação real de PII.
* **Correção recomendada:** Aplicar mesmo truncamento de
  `SignedInAccountCard.tsx`:113:
  ```jsx
  <code>{link.bardo_user_id.slice(0, 8)}…</code>
  ```
  Mostrar full atrás de toggle "show" se necessário.
* **Status:** open (defer)

---

### F6 — Code mapping incompleto em `link-bardo-account` quando Bardo retorna non-2xx

* **Status:** **resolved (2026-05-13 via VI.R4_CODE_MAPPING_PATCH, chronicle 4.33)** — branch `!consume.ok` agora inspeciona `consume.body?.code` antes de fallback genérico. Helper `mapBardoConsumerErrorCode` mapeia `NONCE_ALREADY_CONSUMED → reused_nonce` (403), `NONCE_EXPIRED → expired_nonce` (403), `RATE_LIMITED → bardo_consumer_rate_limited` (429), etc. Smokes `reused_nonce_blocks` e `expired_nonce_blocks` em produção retornam HTTP 403 + code específico (entries 4.33). Edge `link-bardo-account` v7 ACTIVE.
* **Severidade:** low (functional security intacta; perda de fidelity diagnóstica)
* **Categoria:** Error Code Hygiene
* **Arquivos:**
  - `supabase/functions/link-bardo-account/index.ts`:213 (`consumeBardoNonce` retorna `ok: res.ok`)
  - `supabase/functions/link-bardo-account/index.ts`:364-379 (branch `!consume.ok` cai direto em `bardo_consumer_error`)
  - `supabase/functions/link-bardo-account/index.ts`:397-401 (mapping de `bardoCode === 'reused'`/'expired' só corre se Bardo retornou 2xx)
* **Evidência:** smoke `reused_nonce_blocks` (2026-05-13 16:49:14 UTC, chronicle 4.30): 2ª consume do mesmo nonce retornou HTTP 502 `code: bardo_consumer_error` ao invés de 403 `code: reused`. Bardo provavelmente respondeu com non-2xx (e.g. 410 Gone) carregando `code: 'reused'` no body, mas VI ignorou o body e usou só o status para classificar.
* **Explicação:** Quando Bardo responde com erro HTTP (4xx/5xx) carregando informação semântica no body (e.g. `{code: 'reused'}` ou `{code: 'expired'}`), VI atualmente descarta essa info e classifica como erro genérico de consumer. O bloqueio funcional acontece (nenhum vínculo criado), mas UX e logs perdem precisão. Cliente recebe "Could not validate nonce with Bardo" em vez de "Nonce já foi consumido — peça um novo link".
* **Correção recomendada:** No branch `if (!consume.ok)`, inspecionar `consume.body?.code` antes de fallback:
  ```ts
  if (!consume.ok) {
    const bardoCode = typeof consume.body?.code === 'string' ? consume.body.code : null
    if (bardoCode === 'reused') return jsonResponse({ error: 'Link blocked: reused', code: 'reused' }, 403)
    if (bardoCode === 'expired') return jsonResponse({ error: 'Link blocked: expired', code: 'expired' }, 403)
    // fallback genérico
    logLinkAttempt({ result: 'bardo_consumer_error', ... })
    return jsonResponse({ code: 'bardo_consumer_error' }, 502)
  }
  ```
  Aproveitar para também mapear `code: 'malformed_nonce'`, `code: 'mismatch'`, e quaisquer outros códigos documentados do contrato Bardo.
* **Status:** open — endereçar em ciclo R4 (junto com migration `bardo_email_hash` dedicado).

---

### F5 — Heurística em string de erro do backend é locale-frágil

* **Severidade:** low
* **Categoria:** Business Logic Flaw
* **Arquivos:**
  - `src/pages/AcceptInvite.tsx`:108-114
* **Evidência:**
  ```js
  const isEmailMismatch = !!(
    expectedEmail &&
    currentEmail &&
    rawMessage.toLowerCase().includes('mesmo email do convite')
  )
  ```
* **Explicação:** Detecção de account-mismatch (que aciona UI "switch
  account") depende de substring pt-BR match no raw error. Se
  `accept-idea-invite` edge function for localizada ou frase mudar em
  refactor, heurística silenciosamente quebra e usuário cai no path
  de erro genérico em vez de UI de recuperação. Tela de
  account-mismatch é único ponto onde usuário pode recuperar de
  wrong-account login; se parar de disparar, usuários não conseguem
  aceitar convites e não entenderão por quê.
* **Correção recomendada:** Igual F1 — `accept-idea-invite` retorna
  `{ error_code: 'email_mismatch' | ... }`. Cliente switch-case no
  code, não em substring pt-BR. Endereça F1 e F5 juntos.
* **Status:** open

---

### Categorias sem achados (verificadas)

* **XSS no catálogo i18n:** nenhum. Todas as strings renderizam via
  `{t(...)}` em JSX, com auto-escape de React. Sem
  `dangerouslySetInnerHTML` ou `innerHTML` introduzido. Functions
  parametrizadas (`'invite.successMessage': ({ ideaTitle }) => ...`)
  produzem texto puro em text-nodes.
* **Path traversal em `audit-i18n.mjs`:** nenhum. Path hardcoded
  (`path.join(projectRoot, 'src', 'lib', 'i18nMessages.ts')`), sem
  input de usuário, CLI args ou env vars. Dev script only.
* **Auth bypass via client `isAdmin`:** nenhum. Check client é UX
  gating apenas; RLS policy "Admins can update all profiles"
  re-verifica via `public.is_admin()` SECURITY DEFINER que consulta
  `user_profiles.role = 'admin' WHERE user_id = auth.uid()`
  server-side. Painel Admin não permite escalar sem `role='admin'`
  já no DB.
* **OAuth redirect:** linha
  `getAuthRedirectUrl({ webUrl: window.location.href })` em
  `AcceptInvite.tsx`:147 é pré-existente (não introduzida neste
  diff). Allowlist server-side do Supabase continua restringindo
  onde OAuth pode aterrissar.
* **Novos `localStorage` com dado sensível:** nenhum. Única
  referência a `localStorage` no diff é preferência de locale
  (`voiceideas.language.v1`), não-sensível.
* **Nova fetch/POST sem auth:** nenhuma. `getIdeaInvitePreview` é
  GET não-autenticado intencional (precisa funcionar pré-login),
  passa token via query com `encodeURIComponent`, headers só com
  `apikey`. `shareIdeaByEmail`, `acceptIdeaInvite`,
  `link-bardo-account` usam `getAuthenticatedFunctionHeaders()` de
  `functionAuth.ts` que trata refresh JWT e rejeição de sessão
  expirada.
* **Novo log de token/email/ID:** nenhum.
  `console.log/info/warn/debug` não adicionados no range.
