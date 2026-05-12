# VoiceIdeas Remote State Snapshot (2026-04-17)

## 1) Objetivo
Registrar o estado remoto mais recente conhecido para evitar retrabalho e confusao de diagnostico na proxima rodada.

## 2) Snapshot operacional
- Projeto Supabase alvo: `uhzwqhaxnodtshlvvikt`
- Functions bridge ja foram publicadas anteriormente (bridge-items/export-to-cenax).
- Schema bridge no repo esta mais avancado e inclui reconciliacao de legado.

## 3) Comandos executados nesta rodada e resultado

### 3.1 `npx supabase migration list --linked`
Resultado:
- Falhou com 403 de privilegio de conta.

Mensagem principal:
- `unexpected login role status 403`
- `Your account does not have the necessary privileges...`

### 3.2 `npx supabase functions list --project-ref uhzwqhaxnodtshlvvikt`
Resultado:
- Falhou com 403 de privilegio.

Mensagem principal:
- `unexpected list functions status 403`
- `Your account does not have the necessary privileges...`

## 4) Diagnostico objetivo
- O bloqueio atual e de permissao de conta/token para endpoints de gerenciamento Supabase.
- Isso impede confirmacao automatica de estado remoto por CLI nesta sessao.
- Nao e erro de sintaxe SQL nem erro de codigo de function neste momento.

## 5) Proxima acao obrigatoria para quem assumir
1. Ajustar credencial/conta com privilegio no projeto.
2. Reexecutar:
- `npx supabase migration list --linked`
- `npx supabase functions list --project-ref uhzwqhaxnodtshlvvikt`
3. Atualizar este snapshot com a saida real apos recuperar acesso.

## 6) Criterio de desbloqueio
Considerar remoto desbloqueado somente quando ambos os comandos acima retornarem sucesso no ambiente Docker da equipe.
