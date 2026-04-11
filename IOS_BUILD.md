# iOS Capture Behavior

## Product Positioning

### iPhone e iPad

- A captura de audio funciona normalmente enquanto o app esta aberto.
- Ao sair do app, bloquear a tela ou trocar de aplicativo, a captura pode ser interrompida pelo sistema.
- Para garantir a gravacao completa, mantenha o VoiceIdeas em primeiro plano durante toda a captura.

Resumo direto para o usuario:

> No iPhone, grave com o app aberto. Em segundo plano ou com a tela bloqueada, a gravacao pode parar.

## UI Copy

- Label / hint principal:
  - `Requer app aberto no iPhone`
- Mensagem de aviso ao iniciar captura:
  - `No iOS, mantenha o app aberto para nao interromper a gravacao.`
- Info adicional:
  - `O sistema do iPhone pode interromper a captura quando o app nao esta em primeiro plano.`

## Technical Position

### Estado atual

- O iOS opera em modo `foreground-first`.
- A captura depende do ciclo de vida do app ativo.
- Nao ha suporte implementado para:
  - execucao continua com tela bloqueada
  - persistencia nativa de sessao ativa
  - reconexao de captura apos background
  - chunking nativo com manifesto local

### Consequencia pratica

- A captura pode ser interrompida quando o app:
  - vai para background
  - perde foco
  - entra em lock screen

### Garantia atual

- Captura confiavel apenas enquanto o app permanece em foreground.

## Engineering Note

- O comportamento atual e intencional e consistente com a arquitetura vigente.
- O projeto nao deve:
  - prometer captura continua no iOS
  - inferir continuidade apos background
  - mascarar interrupcoes como erro generico

Qualquer evolucao para suporte a lock screen exigira:

- ownership nativo da captura no iOS
- configuracao explicita de sessao de audio compativel com background
- nova camada de persistencia e reconexao

Isso nao esta implementado nesta fase.

## Decision Record

- Android: alvo de captura continua com tela bloqueada
- iOS: suporte limitado a foreground nesta versao

Status atual:

> iOS nao suporta captura continua com tela bloqueada.

## Regra de produto

> Nunca sugerir continuidade no iOS quando ela nao e garantida.

Clareza aqui evita perda de confianca do usuario.

## Build Notes

- shell iOS gerado em `ios/App`
- deep link `voiceideasmobile://auth/callback` configurado no `Info.plist`
- permissoes de microfone e reconhecimento de fala configuradas no `Info.plist`
- plugins iOS presentes no `Package.swift` gerado:
  - `@capacitor/app`
  - `@capacitor/browser`
  - `@capgo/capacitor-audio-recorder`
  - `@capgo/capacitor-speech-recognition`

## Validation Notes

### Checklist iPhone Real

1. abrir `Captura segura`
2. conceder microfone
3. iniciar sessao
4. falar alguns segundos
5. parar explicitamente
6. confirmar sessao salva e `rawStoragePath`
7. abrir a fila
8. confirmar sessao, chunks, drafts e export continuam visiveis

### Checklist Foreground-First

1. iniciar `Captura segura`
2. mandar o app para background
3. confirmar interrupcao honesta
4. confirmar ausencia de falso sucesso

### Checklist Falha de Rede

1. gravar sessao
2. cortar a rede antes do upload
3. confirmar pendencia local
4. confirmar retry manual depois
