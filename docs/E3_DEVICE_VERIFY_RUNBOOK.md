# VI_CAPTURE_ENGINE_UNIFICATION.E3_DEVICE_VERIFY_MANUAL_ENGINE

Runbook para Gian executar em device físico (iPad/iOS + Android) e reportar
PASS/FAIL ao Claude.

---

## Contexto

* Branch atual: `main` HEAD `8cbe068`
* Versão deployada: produção em `https://voiceideas.vercel.app/`
* Chunk principal com E3: `Home-CppZT_gG.js`
* App nativo: iPad usa instalação física (TestFlight / sideload) **ou**
  PWA via Safari adicionado à Tela de Início; Android via APK Capacitor
  **ou** PWA via Chrome.
* O que estamos validando: E3 em hardware real — microfone real,
  permissões nativas, foreground service Android, playback.

**Feature flag:** `voiceideas.capture-engine.use-unified.v1` em
localStorage. `'true'` liga engine no Manual; ausente/`'false'` mantém
legacy.

**Toggle UI:** "Salvar áudio para ouvir depois" só tem efeito quando
flag ON. Persistido em `voiceideas.recorder-ui-preferences.v1`.

---

## Setup comum (antes de cada cenário)

Para mexer no `localStorage` em device:

### iPad / iOS

* **Web Inspector (recomendado, exige Mac):**
  1. Conectar iPad ao Mac por cabo.
  2. Em **Ajustes do iPad → Safari → Avançado → Web Inspector** = ON.
  3. No Mac, abrir **Safari → Desenvolvedor → \[Nome do iPad] → \[Aba VoiceIdeas]**.
  4. No painel Console:
     ```js
     localStorage.setItem('voiceideas.capture-engine.use-unified.v1', 'true')
     // ou para desligar:
     localStorage.removeItem('voiceideas.capture-engine.use-unified.v1')
     ```
  5. Recarregar a página/app.

* **Alternativa sem Mac (PWA via Safari):**
  Não é possível alterar localStorage sem inspector — pular para o Mac.

### Android

* **Chrome DevTools (recomendado):**
  1. No Android: **Configurações → Sobre → tocar 7× em Build** para ativar
     opções de desenvolvedor.
  2. **Opções de desenvolvedor → Depuração USB** = ON.
  3. Conectar Android ao Mac/PC por USB, autorizar trust no Android.
  4. No Chrome do desktop: `chrome://inspect/#devices` → encontrar a aba
     do VoiceIdeas → **Inspect**.
  5. No console DevTools:
     ```js
     localStorage.setItem('voiceideas.capture-engine.use-unified.v1', 'true')
     ```
  6. Recarregar.

### Reset entre cenários

Antes de cada cenário, **limpar gravações em curso**, fechar player se
aberto, e considerar reload se houver estado pendurado.

Para registrar logs do engine, no console:
```js
window.__viLogs = [];
['debug','info','warn','error'].forEach(lvl => {
  const o = console[lvl];
  console[lvl] = function(...args) {
    try { window.__viLogs.push({lvl, args: args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())}); } catch {}
    return o.apply(this, args);
  };
});
```

Depois, copiar logs com:
```js
JSON.stringify(window.__viLogs.filter(l => l.args.some(a => typeof a === 'string' && a.includes('[voiceideas:'))), null, 2)
```

---

## Cenários iPad / iOS

### iOS-1. Flag OFF (Manual legacy)

**Setup:**
```js
localStorage.removeItem('voiceideas.capture-engine.use-unified.v1');
location.reload();
```

**Passos:**
1. Confirmar tab "Manual" selecionada (uma ideia por vez).
2. Tocar Mic → "Gravando áudio..."
3. Falar 3-4 segundos: "teste manual legacy iOS".
4. Tocar para parar.
5. Aguardar transcript aparecer no campo "Texto transcrito".
6. Tocar "Salvar nota".

**Expectativa:**
- [ ] Permission prompt iOS aparece **ou** já está concedida.
- [ ] Gravação inicia (botão pulsa vermelho).
- [ ] Stop dispara transcrição.
- [ ] Transcript aparece (mesmo que abreviado, ex: "Teste manual legacy").
- [ ] Botão "Salvar nota" salva e nota vai pra lista de Recentes.
- [ ] **Toggle "Salvar áudio para ouvir depois"** aparece DESABILITADO
      com hint: "Disponível com o motor unificado. Ative em Configurações
      > localStorage para testar."
- [ ] **Sem logs `[voiceideas:capture-engine]`** no console (engine não
      foi invocado).

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### iOS-2. Flag ON + retain OFF

**Setup:**
```js
localStorage.setItem('voiceideas.capture-engine.use-unified.v1', 'true');
// garantir toggle UI OFF — após reload, verificar
location.reload();
```

Depois do reload, confirmar:
- Toggle "Salvar áudio para ouvir depois" **habilitado mas em posição OFF**.

Se estiver ON, clicar para desligar antes do ciclo.

**Passos:**
1. Tocar Mic → gravar 3-4s → parar.
2. Aguardar transcript.

**Expectativa:**
- [ ] Permission prompt iOS aparece (ou já concedida).
- [ ] Gravação + transcript funcionam.
- [ ] **Sem botão "Ouvir áudio"** após stop (retain OFF).
- [ ] **Sem banner amber** após stop.
- [ ] **Sem upload a `voice-captures`** (network tab no Safari DevTools).
- [ ] Log estruturado no console:
  ```
  [voiceideas:capture-engine] start ok
  { mode: "manual", retainAudio: false, audioFailurePolicy: "throw", ... }

  [voiceideas:capture-engine] stop completed
  { audioPersisted: false, audioStorageError: null, ... }
  ```

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### iOS-3. Flag ON + retain ON

**Setup:**
- Manter flag ON (não recarregar se já está).
- Ligar toggle UI "Salvar áudio para ouvir depois" (slider verde, à direita).

**Passos:**
1. Tocar Mic → gravar 3-4s → parar.
2. Aguardar transcript.

**Expectativa:**
- [ ] Gravação + transcript OK.
- [ ] **Botão "Ouvir áudio" aparece** (verde) após stop.
- [ ] **Aviso "Áudio disponível por 30 dias após a gravação."** abaixo
      do botão.
- [ ] **Sem banner amber** (upload OK).
- [ ] Network: upload POST a `/storage/v1/object/voice-captures/...`
      com status 200.
- [ ] Log:
  ```
  [voiceideas:capture-engine] start ok
  { retainAudio: true, audioFailurePolicy: "best-effort", ... }

  [voiceideas:capture-engine] stop completed
  { audioPersisted: true, audioStorageError: null, ... }
  ```

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### iOS-4. Playback (continuação de iOS-3)

**Passos:**
1. Tocar botão "Ouvir áudio".
2. Aguardar "Preparando áudio..." → player `<audio>` aparecer.
3. Tocar play no controle do player.

**Expectativa:**
- [ ] Botão dispara fetch a `/storage/v1/object/sign/voice-captures/...`.
- [ ] Player nativo iOS aparece com controles (play/pause/scrubber).
- [ ] Áudio toca **com som real** pelos alto-falantes / fone do iPad.
- [ ] Duração mostrada confere com o tempo gravado (~3-4s).
- [ ] **Sem erros** no console.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### iOS-5. Permissão negada

**Setup:**
- **Ajustes do iPad → Safari → Microfone → bloqueado** **ou**
  **Ajustes → \[App VoiceIdeas se nativo] → Microfone = OFF**.
- Flag ON, toggle ON (mantém do cenário anterior).

**Passos:**
1. Voltar pro app, recarregar página.
2. Tocar Mic.

**Expectativa:**
- [ ] Permission prompt iOS aparece e tentativa de gravação falha
      OU app exibe banner de erro de permissão sem prompt (se já negada
      anteriormente).
- [ ] Banner de erro vermelho aparece com mensagem tipo
      `CaptureEngine[permission-denied]: ...`
- [ ] **Nenhuma nota criada** — contador "X de 10 notas hoje" não muda.
- [ ] **Sem upload a voice-captures**.
- [ ] Log de erro:
  ```
  [voiceideas:capture-engine] auth resolveUserId failed | OR similar
  ```
  (esperado pelo menos um log com level error/warn relacionado a
  permission).

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

**Importante:** após este cenário, **reabilitar microfone** nas
Configurações do iPad antes de seguir.

---

### iOS-6. Safe Capture básico (sem regressão)

**Setup:**
- Flag pode estar ON ou OFF (irrelevante — Safe Capture passa por
  hook legacy, não engine).
- Trocar para tab "Captura segura" (escudo, ícone azul-escuro).

**Passos:**
1. Tocar escudo (botão central) → "Gravando a sessão bruta..."
2. Falar 4-5s.
3. Tocar para parar → "Salvando a sessão bruta..."
4. Aguardar painel "Pós-gravação" aparecer.

**Expectativa:**
- [ ] UI "Pós-gravação" aparece com botões "Fazer mágica" / "Salvar bruto" /
      "Nova sessão" / "Usar caminho manual" / "Abrir acervo".
- [ ] Upload a `voice-captures/.../sessions/.../raw.webm` (ou `.m4a`/`.mp4`
      em iOS — depende do MediaRecorder).
- [ ] **Nenhum log `[voiceideas:capture-engine]`** (engine não invocado).
- [ ] **Nenhum erro `safe-async-reserved`** no console.
- [ ] Banner azul "A gravação ficou segura e está sendo enviada..." aparece
      durante o save.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

## Cenários Android

Mesma estrutura dos cenários iOS, com pontos específicos do Android.

### AND-1. Flag OFF (Manual legacy)

**Setup:**
```js
localStorage.removeItem('voiceideas.capture-engine.use-unified.v1');
location.reload();
```

**Passos:** iguais a iOS-1.

**Expectativa Android-specific:**
- [ ] Permission prompt Android (caixa de diálogo do sistema) aparece
      ou já concedida.
- [ ] MediaRecorder usa codec disponível (provavelmente `.webm` ou
      `.opus` no Chrome Android).
- [ ] Tudo igual a iOS-1.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### AND-2. Flag ON + retain OFF

**Passos:** iguais a iOS-2.

**Expectativa Android-specific:**
- [ ] MediaRecorder funciona via Chrome WebView (Capacitor) ou Chrome.
- [ ] Pattern de fetches igual: capture_sessions + transcribe + 0 uploads
      a voice-captures.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### AND-3. Flag ON + retain ON

**Passos:** iguais a iOS-3.

**Expectativa Android-specific:**
- [ ] Upload OK (rede Android costuma ser estável; se em mobile data
      flutuante, observar).
- [ ] Botão "Ouvir áudio" aparece.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### AND-4. Playback

**Passos:** iguais a iOS-4.

**Expectativa Android-specific:**
- [ ] Player `<audio>` Chrome Android com controles nativos.
- [ ] Som real toca pelos alto-falantes / fone.
- [ ] **Atenção:** se o codec gravado for `.opus`/`.webm`, o Chrome
      Android reproduz nativamente. Se for `.m4a`, também OK. Em
      WebView Capacitor, o player usa o mesmo motor.

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

### AND-5. Permissão negada

**Setup:**
- **Configurações Android → Apps → VoiceIdeas (se nativo) → Permissões →
  Microfone = Negar**
- Para Chrome web: **Chrome → Configurações → Permissões de site →
  voiceideas.vercel.app → Microfone = Bloqueado**.
- Flag ON, toggle ON.

**Passos:** iguais a iOS-5.

**Expectativa Android-specific:**
- [ ] Comportamento semelhante a iOS-5 — banner vermelho de erro,
      nenhuma nota criada.
- [ ] Mensagem do banner pode variar ligeiramente em texto (depende
      do user agent / Chrome version).

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

**Importante:** reabilitar permissão antes do próximo cenário.

---

### AND-6. Safe Capture básico (regressão + background)

Cenário Android tem **um teste extra**: validar que Safe Capture continua
funcionando em background (foreground service / notificação persistente).

**Passos básicos:** iguais a iOS-6 → confirmar UI "Pós-gravação".

**Teste extra (background):**
1. Iniciar gravação Safe Capture (clicar escudo, ver "Gravando a sessão
   bruta...").
2. **Sair do app** (home button / gesto).
3. Aguardar 10-15 segundos com o app em background.
4. **Voltar ao app**.
5. Verificar que gravação **continua ativa** (botão ainda vermelho,
   contador de tempo ainda subindo).
6. Parar gravação → confirmar UI pós-gravação normal.

**Expectativa Android-specific:**
- [ ] Notificação persistente aparece na barra de status durante a
      gravação Safe Capture (foreground service).
- [ ] Gravação **NÃO é interrompida** ao sair do app.
- [ ] Ao voltar, app mostra estado consistente (tempo decorrido correto,
      sem reset).
- [ ] Stop após voltar conclui o ciclo normalmente.
- [ ] **Nenhum log `[voiceideas:capture-engine]`** (engine não invocado).

**PASS/FAIL:** \_\_\_\_\_  
**Observações:** \_\_\_\_\_

---

## Como reportar

Copiar este bloco e preencher:

```
=== iPad / iOS ===
iOS-1 (Flag OFF Manual legacy)      : PASS | FAIL — obs:
iOS-2 (Flag ON + retain OFF)        : PASS | FAIL — obs:
iOS-3 (Flag ON + retain ON)         : PASS | FAIL — obs:
iOS-4 (Playback)                    : PASS | FAIL — obs:
iOS-5 (Permissão negada)            : PASS | FAIL — obs:
iOS-6 (Safe Capture)                : PASS | FAIL — obs:

=== Android ===
AND-1 (Flag OFF Manual legacy)      : PASS | FAIL — obs:
AND-2 (Flag ON + retain OFF)        : PASS | FAIL — obs:
AND-3 (Flag ON + retain ON)         : PASS | FAIL — obs:
AND-4 (Playback)                    : PASS | FAIL — obs:
AND-5 (Permissão negada)            : PASS | FAIL — obs:
AND-6 (Safe Capture + background)   : PASS | FAIL — obs:

=== Logs colados (opcional, ajuda diagnóstico) ===
iOS log copy:
<cole o output de JSON.stringify(window.__viLogs.filter(...)) aqui>

Android log copy:
<idem>

=== Modelos testados ===
iPad model / iOS version :
Android device / version :

=== Versão do app instalada ===
Build hash visível em algum lugar (ex: Settings, About) — se nenhum,
ignorar.
```

---

## Critério de PASS global

Validar todos os 12 cenários como PASS para liberar o próximo bloco.
Qualquer FAIL: reportar evidência objetiva (screenshot, log, network
trace) — Claude analisa, decide se hardening adicional ou bug.

## Cleanup pós-smoke

Em cada device, após terminar:
```js
localStorage.removeItem('voiceideas.capture-engine.use-unified.v1');
// reset toggle UI se ligou:
const prefs = JSON.parse(localStorage.getItem('voiceideas.recorder-ui-preferences.v1') || '{}');
prefs.manualRetainAudio = false;
localStorage.setItem('voiceideas.recorder-ui-preferences.v1', JSON.stringify(prefs));
location.reload();
```

E reabilitar permissão de microfone no app, se desligou em iOS-5/AND-5.
