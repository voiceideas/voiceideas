# Supabase Setup

Este projeto agora usa Supabase Edge Functions para:

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
- Modo continuo: continua usando reconhecimento nativo do navegador

## 6. Comandos manuais equivalentes

```bash
npx supabase link --project-ref uhzwqhaxnodtshlvvikt
npx supabase secrets set --env-file supabase/functions.env --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy organize --project-ref uhzwqhaxnodtshlvvikt
npx supabase functions deploy transcribe --project-ref uhzwqhaxnodtshlvvikt
```
