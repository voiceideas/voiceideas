/**
 * VI_TRANSCRIPTION_PROVIDER_VERBATIM_R3 (2026-05-17)
 *
 * Edge function EXPERIMENTAL para avaliação A/B de providers STT em
 * modo verbatim. **NÃO substitui** `/transcribe` de produção. Existe
 * apenas para comparação controlada com áudios fixos e métricas
 * objetivas (preservação de palavras inventadas, números separados,
 * repetições, informalidade) antes de decidir migrar verbatim para
 * um provider alternativo.
 *
 * Providers suportados (`provider` field no FormData):
 *   - `openai-whisper-1` — baseline, igual ao /transcribe verbatim
 *     atual. Útil para A/B contra os novos providers no mesmo áudio.
 *   - `deepgram` — Nova-2 com smart_format=false, punctuate=false,
 *     numerals=false, filler_words=true. Foco em preservar literalidade.
 *   - `assemblyai` — Universal-2 com punctuate=false, format_text=false,
 *     disfluencies=true. Equivalente literal.
 *
 * Secrets necessários (configurar via `supabase secrets set`):
 *   - `OPENAI_API_KEY` (já existente)
 *   - `DEEPGRAM_API_KEY` (novo)
 *   - `ASSEMBLYAI_API_KEY` (novo)
 *
 * Comportamento NÃO alterado em produção:
 *   - `/transcribe` continua deployado e em uso.
 *   - Manual mode continua chamando `/transcribe` (não este endpoint).
 *   - Nenhuma mudança em fluxo Manual, Safe Capture, Bardo, TTL.
 *
 * Guardrails:
 *   - Logs nunca contém áudio, transcript completo, token ou email.
 *   - Provider keys ficam exclusivamente em Supabase Edge Function
 *     secrets — frontend nunca acessa.
 *   - Sem auto-trigger de organize/magic.
 *
 * Spec: ordem `VI_TRANSCRIPTION_PROVIDER_VERBATIM_R3` (Gian, 2026-05-17).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertBusinessRateLimit, assertDailyAiQuota, logAiUsage, logSecurityEvent } from '../_shared/quotas.ts'
import { corsHeaders } from '../_shared/http.ts'
import { getClientIp, json, requireUser } from '../_shared/security.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const DEEPGRAM_API_KEY = Deno.env.get('DEEPGRAM_API_KEY')
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_LANGUAGES = new Set(['pt', 'pt-br', 'en', 'es'])
const ALLOWED_PROVIDERS = new Set(['openai-whisper-1', 'deepgram', 'assemblyai'])
const ALLOWED_MODES = new Set(['verbatim', 'natural'])

type Provider = 'openai-whisper-1' | 'deepgram' | 'assemblyai'
type Mode = 'verbatim' | 'natural'

interface ProviderResult {
  text: string
  provider: Provider
  model: string
  latencyMs: number
  raw?: unknown
}

// ─── CORS / utils ─────────────────────────────────────────────────────

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

function normalizeLanguage(value: FormDataEntryValue | null) {
  const normalized = String(value || 'pt').trim().toLowerCase()
  return ALLOWED_LANGUAGES.has(normalized) ? normalized : 'pt'
}

function normalizeProvider(value: FormDataEntryValue | null): Provider {
  const normalized = String(value || '').trim().toLowerCase()
  if (ALLOWED_PROVIDERS.has(normalized)) return normalized as Provider
  throw json({ error: `provider must be one of: ${Array.from(ALLOWED_PROVIDERS).join(', ')}` }, 400)
}

function normalizeMode(value: FormDataEntryValue | null): Mode {
  const normalized = String(value || 'verbatim').trim().toLowerCase()
  return ALLOWED_MODES.has(normalized) ? (normalized as Mode) : 'verbatim'
}

// ─── Prompt verbatim (reuso conceitual do /transcribe R2) ────────────

const VERBATIM_PROMPTS: Record<string, string> = {
  pt:
    'Transcrever EXATAMENTE o que foi dito, palavra por palavra. ' +
    'NAO corrija, NAO substitua, NAO una, NAO resuma. ' +
    'Regras: ' +
    '(1) Mantenha palavras inventadas ou desconhecidas como soaram, sem corrigir para palavras parecidas; ' +
    '(2) Numeros ditados separadamente sao itens separados (ex: "47, 13, 902" NUNCA vira "4713902"); ' +
    '(3) Mantenha vírgulas entre numeros falados separadamente; ' +
    '(4) Repeticoes consecutivas (ex: "eu eu eu", "talvez talvez") devem aparecer todas; ' +
    '(5) Hesitacoes (uhm, eh, ah, ne) e gaguejos devem ser preservados; ' +
    '(6) NAO conserte gramatica, NAO troque por sinonimos, NAO complete frases; ' +
    '(7) Use pontuacao apenas se o falante claramente pausar.',
  en:
    'Transcribe EXACTLY what was said, word by word. ' +
    'DO NOT correct, DO NOT substitute, DO NOT merge, DO NOT summarize.',
  es:
    'Transcribe EXACTAMENTE lo que se dijo, palabra por palabra. ' +
    'NO corrijas, NO sustituyas, NO unas, NO resumas.',
}

function resolveVerbatimPrompt(language: string): string {
  const key = language.startsWith('pt') ? 'pt' : language.startsWith('es') ? 'es' : 'en'
  return VERBATIM_PROMPTS[key] ?? VERBATIM_PROMPTS.pt
}

// ─── Handler: OpenAI whisper-1 (baseline) ────────────────────────────

async function callOpenAiWhisper1(
  file: File,
  language: string,
  mode: Mode,
): Promise<ProviderResult> {
  if (!OPENAI_API_KEY) throw json({ error: 'OPENAI_API_KEY not configured' }, 500)

  const startedAt = Date.now()
  const openAiFormData = new FormData()
  openAiFormData.append('file', file, file.name || 'voice-note.webm')
  openAiFormData.append('model', 'whisper-1')
  openAiFormData.append('language', language.startsWith('pt') ? 'pt' : language)
  openAiFormData.append('response_format', 'json')
  if (mode === 'verbatim') {
    openAiFormData.append('prompt', resolveVerbatimPrompt(language))
    openAiFormData.append('temperature', '0')
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: openAiFormData,
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw json({ error: `OpenAI API error: ${response.status} - ${errorText.slice(0, 200)}` }, 502)
  }
  const data = (await response.json()) as { text?: string }
  const text = data.text?.trim() ?? ''
  if (!text) throw json({ error: 'OpenAI returned empty transcription' }, 502)

  return {
    text,
    provider: 'openai-whisper-1',
    model: 'whisper-1',
    latencyMs: Date.now() - startedAt,
  }
}

// ─── Handler: Deepgram (Nova-2, foco verbatim) ───────────────────────

async function callDeepgram(
  file: File,
  language: string,
  mode: Mode,
): Promise<ProviderResult> {
  if (!DEEPGRAM_API_KEY) throw json({ error: 'DEEPGRAM_API_KEY not configured' }, 500)

  const startedAt = Date.now()

  // Deepgram aceita audio binário direto via POST body.
  // Mapeamento de língua: pt → pt, pt-br → pt, en → en, es → es.
  const dgLanguage = language.startsWith('pt') ? 'pt' : language.startsWith('es') ? 'es' : 'en'

  // Query params para máxima literalidade quando mode='verbatim':
  //   - model=nova-2-general (melhor qualidade atual, multilíngue)
  //   - smart_format=false  — não converte números/datas/moeda
  //   - punctuate=false     — sem pontuação automática
  //   - numerals=false      — mantém forma falada ("forty-seven" em vez de "47")
  //   - filler_words=true   — preserva "um", "uh", "you know"
  //   - profanity_filter=false — não substitui palavras por asteriscos
  //   - dictation=false     — modo dictation tenta interpretar comandos
  //
  // Em mode='natural', deixa Deepgram aplicar smart_format default.
  const params = new URLSearchParams({
    model: 'nova-2-general',
    language: dgLanguage,
    smart_format: mode === 'verbatim' ? 'false' : 'true',
    punctuate: mode === 'verbatim' ? 'false' : 'true',
    numerals: mode === 'verbatim' ? 'false' : 'true',
    filler_words: 'true',
    profanity_filter: 'false',
    dictation: 'false',
  })

  const audioBuffer = await file.arrayBuffer()
  const contentType = file.type || 'audio/webm'

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw json({ error: `Deepgram API error: ${response.status} - ${errorText.slice(0, 200)}` }, 502)
  }

  const data = (await response.json()) as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string; confidence?: number }>
      }>
    }
  }
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  if (!text) throw json({ error: 'Deepgram returned empty transcription' }, 502)

  return {
    text,
    provider: 'deepgram',
    model: 'nova-2-general',
    latencyMs: Date.now() - startedAt,
  }
}

// ─── Handler: AssemblyAI (Universal-2, foco verbatim) ────────────────

/**
 * AssemblyAI é assíncrono: precisa (1) upload do arquivo, (2) criar
 * transcript job, (3) poll até completed/error. Polling com timeout
 * generoso (90s) — áudios de até 10MB tipicamente processam em < 30s.
 *
 * Modo verbatim usa:
 *   - punctuate=false
 *   - format_text=false
 *   - disfluencies=true   (preserva "uh", "um", "you know")
 *   - language_detection=false + language_code explícito
 */
async function callAssemblyAI(
  file: File,
  language: string,
  mode: Mode,
): Promise<ProviderResult> {
  if (!ASSEMBLYAI_API_KEY) throw json({ error: 'ASSEMBLYAI_API_KEY not configured' }, 500)

  const startedAt = Date.now()
  const audioBuffer = await file.arrayBuffer()

  // 1. Upload do áudio.
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: ASSEMBLYAI_API_KEY,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBuffer,
  })
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    throw json({ error: `AssemblyAI upload error: ${uploadResponse.status} - ${errorText.slice(0, 200)}` }, 502)
  }
  const { upload_url } = (await uploadResponse.json()) as { upload_url?: string }
  if (!upload_url) throw json({ error: 'AssemblyAI upload returned no URL' }, 502)

  // 2. Submit transcript job.
  const aaiLanguage = language.startsWith('pt') ? 'pt' : language.startsWith('es') ? 'es' : 'en'
  const transcriptOptions: Record<string, unknown> = {
    audio_url: upload_url,
    language_code: aaiLanguage,
  }
  if (mode === 'verbatim') {
    transcriptOptions.punctuate = false
    transcriptOptions.format_text = false
    transcriptOptions.disfluencies = true
  }
  const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      Authorization: ASSEMBLYAI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(transcriptOptions),
  })
  if (!submitResponse.ok) {
    const errorText = await submitResponse.text()
    throw json({ error: `AssemblyAI submit error: ${submitResponse.status} - ${errorText.slice(0, 200)}` }, 502)
  }
  const submitData = (await submitResponse.json()) as { id?: string; status?: string }
  if (!submitData.id) throw json({ error: 'AssemblyAI submit returned no job id' }, 502)

  // 3. Poll até completed ou error. Timeout 90s, intervalo 2s.
  const pollUrl = `https://api.assemblyai.com/v2/transcript/${submitData.id}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const pollResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    })
    if (!pollResponse.ok) {
      const errorText = await pollResponse.text()
      throw json({ error: `AssemblyAI poll error: ${pollResponse.status} - ${errorText.slice(0, 200)}` }, 502)
    }
    const pollData = (await pollResponse.json()) as {
      status?: string
      text?: string
      error?: string
    }
    if (pollData.status === 'completed') {
      const text = pollData.text?.trim() ?? ''
      if (!text) throw json({ error: 'AssemblyAI returned empty transcription' }, 502)
      return {
        text,
        provider: 'assemblyai',
        model: 'universal-2',
        latencyMs: Date.now() - startedAt,
      }
    }
    if (pollData.status === 'error') {
      throw json({ error: `AssemblyAI job error: ${pollData.error ?? 'unknown'}` }, 502)
    }
    // status === 'queued' | 'processing' — continua polling
  }
  throw json({ error: 'AssemblyAI poll timed out after 90s' }, 504)
}

// ─── Cost estimation (rough) ─────────────────────────────────────────

/**
 * Estimativas grosseiras baseadas em pricing público dos providers.
 * Atualize quando os pricings mudarem. Não bloqueia chamada — só audit.
 */
function estimateCostUsd(provider: Provider, fileSizeBytes: number): number {
  // Assumir ~8MB ≈ 60s áudio (estimativa conservadora pra webm/m4a).
  const estimatedSeconds = (fileSizeBytes / (8 * 1024 * 1024)) * 60
  const estimatedMinutes = estimatedSeconds / 60
  switch (provider) {
    case 'openai-whisper-1':
      // $0.006 / minute
      return Number((estimatedMinutes * 0.006).toFixed(4))
    case 'deepgram':
      // Nova-2: $0.0043 / minute (pre-recorded)
      return Number((estimatedMinutes * 0.0043).toFixed(4))
    case 'assemblyai':
      // Universal-2: ~$0.00065 / second = $0.039 / minute
      return Number((estimatedMinutes * 0.039).toFixed(4))
  }
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    const { user, adminClient } = await requireUser(req)
    const ip = getClientIp(req)

    // Rate limit conservador — endpoint experimental não deve substituir prod.
    await assertBusinessRateLimit(adminClient, user.id, 'experimental_transcribe_call', 10)
    await assertDailyAiQuota(adminClient, user.id, 'experimental_transcribe')

    const formData = await req.formData()
    const file = formData.get('file')
    const language = normalizeLanguage(formData.get('language'))
    const provider = normalizeProvider(formData.get('provider'))
    const mode = normalizeMode(formData.get('transcription_mode'))

    if (!(file instanceof File)) {
      return withCors(json({ error: 'Audio file is required' }, 400))
    }
    if (!file.size) {
      return withCors(json({ error: 'Audio file is empty' }, 400))
    }
    if (file.size > MAX_FILE_BYTES) {
      return withCors(json({ error: 'Audio file exceeds the 10 MB limit' }, 400))
    }

    let result: ProviderResult
    switch (provider) {
      case 'openai-whisper-1':
        result = await callOpenAiWhisper1(file, language, mode)
        break
      case 'deepgram':
        result = await callDeepgram(file, language, mode)
        break
      case 'assemblyai':
        result = await callAssemblyAI(file, language, mode)
        break
    }

    const estimatedCost = estimateCostUsd(provider, file.size)

    // Audit — NUNCA loga transcript completo, áudio, token ou email.
    await logSecurityEvent(adminClient, {
      user_id: user.id,
      event_type: 'experimental_transcribe_call',
      ip,
      metadata: {
        language,
        provider,
        model: result.model,
        transcriptionMode: mode,
        mimeType: file.type || 'unknown',
        fileSize: file.size,
        latencyMs: result.latencyMs,
        transcriptLength: result.text.length,
        estimatedCostUsd: estimatedCost,
      },
    })
    await logAiUsage(
      adminClient,
      user.id,
      'experimental_transcribe',
      Math.ceil(file.size / 1024),
      estimatedCost,
    )

    return withCors(
      json({
        text: result.text,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        transcriptionMode: mode,
        estimatedCostUsd: estimatedCost,
      }),
    )
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }
    console.error(error)
    return withCors(json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500))
  }
})
