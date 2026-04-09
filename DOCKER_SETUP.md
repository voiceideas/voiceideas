# Docker Setup

Este ambiente Docker isola as credenciais e dependencias Linux do VoiceIdeas para que outros agentes nao pisem no `gh`, `supabase` ou `wrangler`.

## O que fica isolado

- `voiceideas-codex-gh-config` -> `/root/.config/gh`
- `voiceideas-codex-git-config` -> `/root/.config/git`
- `voiceideas-codex-supabase-config` -> `/root/.config/supabase`
- `voiceideas-codex-wrangler-config` -> `/root/.wrangler`
- `voiceideas-codex-node-modules` -> `/workspace/node_modules`
- `voiceideas-codex-npm-cache` -> `/root/.npm`

## Preparacao

1. Copie `.env.docker.example` para `.env.docker`.
2. Preencha os tokens que quiser deixar disponiveis no container:

```bash
cp .env.docker.example .env.docker
```

```dotenv
GH_TOKEN=ghp_xxxxx
CLOUDFLARE_API_TOKEN=xxxxx
SUPABASE_ACCESS_TOKEN=xxxxx
```

## Comandos

```bash
npm run docker:shell
npm run docker:dev
npm run docker:build
npm run docker:lint
npm run docker:security:test
npm run docker:deploy
```

## Observacoes

- `docker:deploy` faz `build + security:test + push` de um branch ja commitado. Ele falha se a arvore estiver suja.
- iOS, macOS e partes do fluxo mobile que dependem de `sips`, Xcode ou toolchains Apple continuam sendo executados no host.
- O bootstrap instala dependencias Linux automaticamente no volume nomeado quando o `package-lock.json` muda.
