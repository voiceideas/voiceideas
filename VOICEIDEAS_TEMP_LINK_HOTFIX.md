# HOTFIX.LINK.1 — Vínculo ad-hoc em `bardo_account_links`

> **STATUS: TEMPORÁRIO. Este hotfix existe apenas para destravar o teste
> end-to-end da Inbox do Bardo e NÃO substitui o fix sistêmico. Remover
> quando o fluxo de vínculo correto estiver em produção.**

## Motivo

Após o fix de contrato na EF `bridge-inbox` do Bardo (passou a enviar
`bardo_user_id` na listagem de `bridge-exports` do VI), o 400
`bardo_user_id_required` deixou de aparecer. Em seu lugar, o VI passou
a responder **403 `account_link_required`**: o contrato P1.3+ exige
vínculo explícito em `public.bardo_account_links`, e para o usuário de
teste esse vínculo nunca havia sido criado.

Causa raiz sistêmica (não coberta neste hotfix): o fluxo de "conectar ao
VI" no Bardo chama apenas `bridge-identity-check` (verifica existência
de conta VI verificada via `auth.users`) e trata o retorno como
`connected`. Ele NÃO chama `link-bardo-account` para produzir a row em
`bardo_account_links`. Identidade ≠ vínculo.

## Intervenção manual

INSERT único em `public.bardo_account_links` via Supabase Management API
(`/v1/projects/uhzwqhaxnodtshlvvikt/database/query`).

### Dados inseridos

| Campo | Valor |
| --- | --- |
| `id` | `a5273c62-7c51-46ad-b8cd-dc4942803f65` |
| `vi_user_id` | `b9cb0959-2495-49f8-a8a4-909312e4aa9f` |
| `bardo_user_id` | `642f4864-d1d9-4ebe-a626-d34c1f8027e2` |
| `bardo_email` | `conactseculo21@gmail.com` |
| `link_status` | `active` |
| `linked_at` | `2026-04-19 21:24:57.818502+00` |
| `created_at` | `2026-04-19 21:24:57.818502+00` |

Timestamp do hotfix: **2026-04-19T21:24:57Z**.

### Precondição verificada antes do INSERT

Query `SELECT … WHERE vi_user_id=… AND bardo_user_id=… AND link_status='active'`
retornou `[]` — nenhum vínculo ativo existente. Não houve duplicação.

### Comando equivalente (reversão)

```sql
UPDATE public.bardo_account_links
SET link_status = 'revoked',
    revoked_at = now()
WHERE id = 'a5273c62-7c51-46ad-b8cd-dc4942803f65';
```

Ou, se a cleanup aceitar delete físico:

```sql
DELETE FROM public.bardo_account_links
WHERE id = 'a5273c62-7c51-46ad-b8cd-dc4942803f65';
```

## O que NÃO foi tocado

- Nenhuma edge function foi alterada.
- Nenhuma policy (RLS) foi alterada.
- Regra `account_link_required` em `bridge-exports` permanece idêntica.
- Helper `getActiveBardoAccountLink` permanece idêntico.
- Migrations não foram alteradas.

Este hotfix é estritamente um data-patch em 1 row.

## Fix sistêmico pendente

O fluxo "conectar ao VI" no Bardo precisa, além de verificar identidade
via `bridge-identity-check`, chamar `POST /link-bardo-account` no VI com
o JWT VI do usuário para produzir o vínculo em `bardo_account_links`.
Enquanto isso não acontecer, cada novo usuário reproduzirá o mesmo
`403 account_link_required` e precisará de hotfix equivalente.

Ticket de follow-up sugerido: **SYSFIX.LINK.1 — integrar
`link-bardo-account` ao fluxo de conexão Bardo↔VI**.

## Remoção do hotfix

Quando SYSFIX.LINK.1 estiver em produção e o fluxo normal produzir
vínculos automaticamente, esta row pode ser:

1. Mantida (já é exatamente o que o fluxo produziria), ou
2. Revogada + re-criada via o fluxo normal, para garantir coerência
   de origem.

Decisão fica com o responsável do SYSFIX.LINK.1.
