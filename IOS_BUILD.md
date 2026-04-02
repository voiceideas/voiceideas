# iOS Build

## Estado Atual

- shell iOS gerado em `ios/App`
- captura segura preparada para iPhone com gravador nativo Capacitor
- postura oficial: `foreground-first`
- deep link `voiceideasmobile://auth/callback` configurado no `Info.plist`
- permissões de microfone e reconhecimento de fala configuradas no `Info.plist`

## O Que Esta Validado Neste Repo

- `@capacitor/ios` instalado
- `npx cap add ios` executado com sucesso
- `npx cap sync ios` deve atualizar web assets e plugins no shell iOS
- plugins iOS presentes no `Package.swift` gerado:
  - `@capacitor/app`
  - `@capacitor/browser`
  - `@capgo/capacitor-audio-recorder`
  - `@capgo/capacitor-speech-recognition`

## O Que Ainda Depende Da Maquina Local

Para buildar e validar em simulador ou iPhone real, esta maquina precisa de:

1. `Xcode.app` instalado
2. `xcode-select` apontando para o Xcode completo
3. simulador bootado ou iPhone conectado
4. assinatura Apple adequada para aparelho real

Hoje este ambiente esta apenas com `CommandLineTools`, entao:

- `xcodebuild` nao funciona
- `simctl` nao funciona
- a validacao em simulador/aparelho real nao pode ser concluida aqui

## Fluxo Recomendado

1. `npm run ios:sync`
2. `npm run ios:open`
3. no Xcode:
   - abrir o target `App`
   - configurar signing
   - rodar em iPhone real

## Checklist iPhone Real

1. abrir `Captura segura`
2. conceder microfone
3. iniciar sessao
4. falar alguns segundos
5. parar explicitamente
6. confirmar sessao salva e `rawStoragePath`
7. abrir a fila
8. confirmar sessao/chunks/drafts/export continuam visiveis

## Checklist Foreground-First

1. iniciar `Captura segura`
2. mandar o app para background
3. confirmar interrupcao honesta
4. confirmar ausencia de falso sucesso

## Checklist Falha De Rede

1. gravar sessao
2. cortar a rede antes do upload
3. confirmar pendencia local
4. confirmar retry manual depois
