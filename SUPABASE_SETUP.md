# Supabase Setup

Este projeto agora usa Supabase Edge Functions para:

- compartilhar ideias organizadas (`share-idea`)
- aceitar convites de compartilhamento (`accept-idea-invite`)
- listar ideias compartilhadas (`list-shared-ideas`)
- organizar notas com IA (`organize`)
- transcrever audio do modo manual (`transcribe`)

## 1. Login e link do projeto

```bash
bash scripts/supabase-link.sh
```

O script usa por padrao o project ref `uhzwqhaxnodtshlvvikt`.
Se quiser sobrescrever:

```bash
SUPABASE_PROJECT_REF=seu_project_ref bash scripts/supabase-link.sh
```

## 2. Configurar secrets da OpenAI

Crie o arquivo `supabase/functions.env` a partir de `supabase/functions.env.example`:

```bash
cp supabase/functions.env.example supabase/functions.env
```

Preencha com sua chave:

```bash
OPENAI_API_KEY=sk-...
```

Envie os secrets:

```bash
bash scripts/supabase-push-secrets.sh
```

## 3. Deploy das Edge Functions

```bash
bash scripts/supabase-deploy-functions.sh
```

## 3.1. Aplicar as migrations da v0.2

Antes de testar o compartilhamento, aplique a migration:

```bash
supabase/migrations/20260317000000_share_ideas_v02.sql
supabase/migrations/202603171610_share_ideas_v02_recursion_fix.sql
supabase/migrations/202603171700_share_ideas_v02_links.sql
supabase/migrations/202603180001_share_ideas_v02_finalize_links.sql
supabase/migrations/202603190001_create_note_with_limit_and_harden_functions.sql
supabase/migrations/202603190002_backfill_core_schema_and_safe_rpcs.sql
```

O modelo antigo cria as tabelas:

- `organized_idea_invites`
- `organized_idea_members`

As migrations novas movem o compartilhamento para um modelo de vinculo:

- `organized_idea_shares`
- `organized_idea_share_invites`
- `organized_idea_share_members`

Com isso:

- `organized_ideas` volta a ser lida apenas pelo dono
- ideias compartilhadas passam a ser carregadas por `list-shared-ideas`
- convites e membros ficam fora da RLS de `organized_ideas`, evitando recursao

## 4. Frontend

No frontend e na Vercel, mantenha apenas:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Nao use `VITE_OPENAI_API_KEY` no cliente.

## 5. Teste esperado

- Modo manual: grava audio, envia para a function `transcribe` e retorna o texto
- Organizar com IA: usa a function `organize`
- Compartilhar ideia: usa `share-idea`, `accept-idea-invite` e `list-shared-ideas`
- Modo continuo: continua usando reconhecimento nativo do navegador

## 6. Comandos manuais equivalentes

```bash
npx supabase link --project-ref uhzwqhaxnodtshlvvikt
npx supabase secrets set --env-file supabase/functions.env --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy accept-idea-invite --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy list-shared-ideas --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy organize --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy share-idea --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy transcribe --project-ref uhzwqhaxnodtshlvvikt
```
