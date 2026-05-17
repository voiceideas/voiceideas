# VI_TRANSCRIPTION_PROVIDER_VERBATIM_R3 — Runbook A/B

Comparação controlada de providers STT em modo verbatim, sem alterar
produção. Gian executa este runbook após Claude entregar o endpoint
experimental.

---

## 1. Setup de secrets (uma vez)

Os secrets vão direto no Supabase Edge Functions runtime — **nunca**
no frontend. Use o `codex` docker conforme convenção do projeto:

```bash
docker compose run --rm codex supabase secrets set \
  --project-ref uhzwqhaxnodtshlvvikt \
  DEEPGRAM_API_KEY=<sua key Deepgram> \
  ASSEMBLYAI_API_KEY=<sua key AssemblyAI>
```

Onde pegar as keys:

* **Deepgram:** https://console.deepgram.com/ → API Keys (gera key
  free tier; $200 grátis na primeira inscrição).
* **AssemblyAI:** https://www.assemblyai.com/dashboard → API Keys
  (free tier $50).

`OPENAI_API_KEY` já está configurada (usada por `/transcribe` prod).

**Confirmar que as secrets foram aplicadas:**

```bash
docker compose run --rm codex supabase secrets list \
  --project-ref uhzwqhaxnodtshlvvikt | grep -E "DEEPGRAM|ASSEMBLY|OPENAI"
```

---

## 2. Deploy do endpoint experimental

Já deployado por Claude no commit de entrega da R3:

```bash
docker compose run --rm codex supabase functions deploy transcribe-experimental \
  --project-ref uhzwqhaxnodtshlvvikt
```

Endpoint:
`https://uhzwqhaxnodtshlvvikt.supabase.co/functions/v1/transcribe-experimental`

`/transcribe` de produção **não foi alterado** — Manual continua
chamando o endpoint atual com `whisper-1` em verbatim.

---

## 3. Gravar 4 áudios de teste

Pelo iPad (Safari ou app nativo Voice Memos) ou Android, gravar áudios
curtos (5-15s) em PT-BR claro, salvar como `.m4a`/`.mp3`/`.webm`:

| Label | Fala recomendada |
|---|---|
| **A** | "O projeto se chama **Zambuteco** e isso não deve ser corrigido." |
| **B** | "O código é **47**, **13**, **902**, e o valor é **1.250 reais**." (faça pausas claras entre os números) |
| **C** | "**Eu eu eu** acho que **talvez talvez** isso funcione." (repita as palavras consecutivamente, sem pausa) |
| **D** | "**Tipo assim**, eu **tava** meio sem saber o que fazer, **né?**" |

Transferir os 4 arquivos para o Mac (AirDrop, Drive, Files). Coloque-os
em uma pasta local, ex: `~/Downloads/r3-audios/`.

---

## 4. Obter token de acesso

Logado em `https://voiceideas.vercel.app/` no Chrome (com sessão Gian),
abrir DevTools → Console → colar:

```js
JSON.parse(localStorage.getItem(
  Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
)).access_token
```

Copiar o token retornado (string longa começando com `eyJ...`).
**Token expira em 1 hora** — repete o passo se necessário.

---

## 5. Rodar a comparação

A partir da raiz do projeto:

```bash
node scripts/compare-transcription-providers.mjs \
  --endpoint https://uhzwqhaxnodtshlvvikt.supabase.co/functions/v1/transcribe-experimental \
  --token "eyJ...<seu token>" \
  --audio ~/Downloads/r3-audios/audio_A.m4a:A \
  --audio ~/Downloads/r3-audios/audio_B.m4a:B \
  --audio ~/Downloads/r3-audios/audio_C.m4a:C \
  --audio ~/Downloads/r3-audios/audio_D.m4a:D \
  --providers openai-whisper-1,deepgram,assemblyai \
  --mode verbatim \
  --language pt \
  --out docs/r3-results.md
```

Saídas:

* `docs/r3-results.md` — matriz Markdown legível
* `docs/r3-results.json` — dados crus (texto + métricas) para auditoria

O script roda **3 providers × 4 áudios = 12 chamadas**. Tempo estimado:
30-90 segundos (AssemblyAI é o mais lento por causa do poll).

---

## 6. Interpretar resultados

O `report.md` tem 4 seções (uma por áudio) + um score consolidado.

**Cada áudio** mostra:

* Texto retornado por cada provider
* Latência (client e server)
* Custo estimado (USD por áudio)
* Tabela de checks booleanos específicos do áudio:
  * **A:** `preservedInventedWord_Zambuteco`, `didNotCorrectTo_Zamboteco`
  * **B:** `preservedNumbersSeparated_47_13_902`, `didNotConcatenate_4713902`, `value_form_observed` (informativo)
  * **C:** `repeatedEu_count` (≥3 esperado), `repeatedTalvez_count` (≥2), `preservedAllThreeEu`, `preservedBothTalvez`
  * **D:** `preservedTipoAssim`, `preservedNe`, `preservedTava_orTavaMeio`, `didNotEditorialize_estava`

**Score consolidado** ranqueia providers por % de checks booleanos PASS.

---

## 7. Critério de aceite R3

| Critério | Como avaliar |
|---|---|
| `Zambuteco` não pode virar `Zamboteco` | check booleano em A |
| `47, 13, 902` não pode virar `4713902` | check booleano em B |
| `eu eu eu` não pode virar apenas `eu` | `repeatedEu_count ≥ 3` em C |
| `talvez talvez` não pode virar apenas `talvez` | `repeatedTalvez_count ≥ 2` em C |
| frase informal não pode virar texto editorial | checks em D |
| transcrição bruta não interpretada | inspeção visual do texto |

**Provider vencedor:** aquele que satisfaz 100% dos critérios acima,
com latência e custo aceitáveis para uso em produção.

---

## 8. Decisão pós-A/B

* Se **um provider atinge 100% dos critérios** → ordem para R4 migrar
  `/transcribe` produção do `whisper-1` para o novo provider (manter
  whisper-1 como fallback).
* Se **nenhum provider atinge 100%** → registrar limitação objetiva
  na crônica, escolher o melhor disponível, considerar combinar 2
  providers (ex: Deepgram para verbatim + Whisper como fallback se
  Deepgram falhar).
* Se **todos falharem em algum critério estrutural** → ordem para
  testar Google STT (Tier 3) ou aceitar limitação documentada.

---

## 9. Cleanup pós-experimento

Endpoint experimental pode ficar deployado indefinidamente (não interfere
em produção). Quando o trilho VERBATIM for fechado:

```bash
# Opcional: remover endpoint experimental
docker compose run --rm codex supabase functions delete transcribe-experimental \
  --project-ref uhzwqhaxnodtshlvvikt

# Opcional: remover secrets se não forem migradas para prod
docker compose run --rm codex supabase secrets unset \
  --project-ref uhzwqhaxnodtshlvvikt \
  DEEPGRAM_API_KEY ASSEMBLYAI_API_KEY
```

---

## Como reportar a Claude

Depois de rodar o script, colar o conteúdo de `docs/r3-results.md`
(ou pelo menos a seção "Score consolidado" + tabelas de checks por
áudio) na conversa. Claude consolida na crônica e decide próxima etapa.
