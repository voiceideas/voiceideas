import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { assertBusinessRateLimit, assertDailyAiQuota, logAiUsage, logSecurityEvent } from '../_shared/quotas.ts'
import { corsHeaders } from '../_shared/http.ts'
import { getClientIp, json, requireUser } from '../_shared/security.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_LANGUAGES = new Set(['pt', 'pt-br', 'en', 'es'])
const ALLOWED_TRANSCRIPTION_MODES = new Set(['verbatim', 'natural'])

/**
 * VI_TRANSCRIPTION_VERBATIM_HARDENING_R2 (2026-05-17).
 *
 * Prompt enviado ao modelo de transcrição quando o cliente pede
 * `transcription_mode=verbatim`. Endurecido após R1 mostrar falhas
 * reais em produção (iPad Safari):
 *   - "Zambuteco" → "Zamboteco" (palavra inventada normalizada)
 *   - "47, 13, 902" → "4713902" (números agrupados, vírgulas perdidas)
 *   - "eu eu eu" → "eu" (repetição colapsada)
 *   - "talvez talvez" → "talvez" (idem)
 *
 * Estratégia R2 do prompt:
 *   - Linguagem mais direta e em formato de regras numeradas.
 *   - Exemplos explícitos do que NÃO fazer (anti-exemplos).
 *   - Removida instrução ambígua "Pontuacao minima" (R1 confundiu com
 *     "remover vírgulas entre números").
 *   - Repete a regra de números separados (47, 13, 902 NÃO é 4713902).
 *   - Repete a regra de palavras desconhecidas (não substituir por
 *     similar conhecida).
 *
 * Whisper aceita até ~224 tokens de prompt. Mantemos abaixo desse
 * limite com margem.
 */
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
    'DO NOT correct, DO NOT substitute, DO NOT merge, DO NOT summarize. ' +
    'Rules: ' +
    '(1) Keep invented or unknown words exactly as they sounded, never correct to similar known words; ' +
    '(2) Numbers spoken separately are separate items (e.g. "47, 13, 902" NEVER becomes "4713902"); ' +
    '(3) Keep commas between separately-spoken numbers; ' +
    '(4) Consecutive repetitions (e.g. "I I I", "maybe maybe") must all appear; ' +
    '(5) Hesitations (uhm, eh, ah, you know) and stutters must be preserved; ' +
    '(6) DO NOT fix grammar, DO NOT swap synonyms, DO NOT complete sentences; ' +
    '(7) Only add punctuation where the speaker clearly pauses.',
  es:
    'Transcribe EXACTAMENTE lo que se dijo, palabra por palabra. ' +
    'NO corrijas, NO sustituyas, NO unas, NO resumas. ' +
    'Reglas: ' +
    '(1) Mantén palabras inventadas o desconocidas como sonaron, sin corregir a palabras parecidas; ' +
    '(2) Numeros dichos por separado son items separados (ej: "47, 13, 902" NUNCA es "4713902"); ' +
    '(3) Mantén las comas entre numeros dichos por separado; ' +
    '(4) Repeticiones consecutivas (ej: "yo yo yo", "tal vez tal vez") deben aparecer todas; ' +
    '(5) Titubeos (eh, em, ah, este) y tartamudeos deben preservarse; ' +
    '(6) NO arregles gramatica, NO cambies por sinonimos, NO completes frases; ' +
    '(7) Usa puntuacion solo cuando el hablante claramente pausa.',
}

/**
 * VI_TRANSCRIPTION_VERBATIM_HARDENING_R2 (2026-05-17).
 *
 * Modelo OpenAI usado por modo:
 *   - `natural` (default): `gpt-4o-transcribe` — AI-enhanced, output
 *     mais polido e legível. Comportamento original pré-VERBATIM.
 *   - `verbatim`: `whisper-1` — modelo original, menos "inteligente",
 *     mais literal. `gpt-4o-transcribe` é treinado para limpar fala
 *     ativamente (paráfrase é feature, não bug, para use cases default).
 *     `whisper-1` respeita melhor o prompt restritivo e tende a
 *     transcrever sem aplicar polish — exatamente o que verbatim quer.
 *
 * Esta separação foi adicionada em R2 após observação de que mesmo com
 * prompt restritivo, `gpt-4o-transcribe` continuava normalizando
 * palavras inventadas e agrupando números.
 */
const TRANSCRIPTION_MODELS = {
  natural: 'gpt-4o-transcribe',
  verbatim: 'whisper-1',
} as const

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

function normalizeTranscriptionMode(value: FormDataEntryValue | null): 'verbatim' | 'natural' | null {
  if (value === null) return null
  const normalized = String(value).trim().toLowerCase()
  return ALLOWED_TRANSCRIPTION_MODES.has(normalized) ? (normalized as 'verbatim' | 'natural') : null
}

function resolveVerbatimPrompt(language: string): string {
  const key = language.startsWith('pt') ? 'pt' : language.startsWith('es') ? 'es' : 'en'
  return VERBATIM_PROMPTS[key] ?? VERBATIM_PROMPTS.pt
}

function estimateTranscriptionCost(fileSize: number) {
  return Math.max(0.003, Number((fileSize / (8 * 1024 * 1024) * 0.006).toFixed(4)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return withCors(json({ error: 'Method not allowed' }, 405))
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const { user, adminClient } = await requireUser(req)
    const ip = getClientIp(req)

    await assertBusinessRateLimit(adminClient, user.id, 'legacy_transcribe_call', 20)
    await assertDailyAiQuota(adminClient, user.id, 'legacy_transcribe')

    const formData = await req.formData()
    const file = formData.get('file')
    const language = normalizeLanguage(formData.get('language'))
    // VI_MANUAL_TRANSCRIPTION_VERBATIM_MODE (2026-05-17): default
    // 'natural' (compat com chamadores legados pré-VERBATIM); cliente
    // novo passa explicitamente 'verbatim'.
    const transcriptionMode = normalizeTranscriptionMode(formData.get('transcription_mode')) ?? 'natural'

    if (!(file instanceof File)) {
      return withCors(json({ error: 'Audio file is required' }, 400))
    }

    if (!file.size) {
      return withCors(json({ error: 'Audio file is empty' }, 400))
    }

    if (file.size > MAX_FILE_BYTES) {
      return withCors(json({ error: 'Audio file exceeds the 10 MB limit for this endpoint' }, 400))
    }

    // VI_TRANSCRIPTION_VERBATIM_HARDENING_R2 (2026-05-17): modelo
    // depende do modo. verbatim → whisper-1 (mais literal),
    // natural → gpt-4o-transcribe (legacy default).
    const openAiModel = TRANSCRIPTION_MODELS[transcriptionMode]

    const openAiFormData = new FormData()
    openAiFormData.append('file', file, file.name || 'voice-note.webm')
    openAiFormData.append('model', openAiModel)
    openAiFormData.append('language', language.startsWith('pt') ? 'pt' : language)
    openAiFormData.append('response_format', 'json')
    if (transcriptionMode === 'verbatim') {
      // R2: prompt agressivo com regras numeradas e anti-exemplos.
      // Combinado com whisper-1 + temperature 0, maximiza chance de
      // o modelo NÃO normalizar palavras inventadas, números ditados
      // separadamente, repetições e hesitações.
      openAiFormData.append('prompt', resolveVerbatimPrompt(language))
      openAiFormData.append('temperature', '0')
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: openAiFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as { text?: string }
    const text = data.text?.trim()

    if (!text) {
      throw new Error('OpenAI returned an empty transcription')
    }

    await logSecurityEvent(adminClient, {
      user_id: user.id,
      event_type: 'legacy_transcribe_call',
      ip,
      metadata: {
        language,
        mimeType: file.type || 'unknown',
        fileSize: file.size,
        // VI_MANUAL_TRANSCRIPTION_VERBATIM_MODE: audit do modo usado.
        transcriptionMode,
        // VI_TRANSCRIPTION_VERBATIM_HARDENING_R2: audit do modelo
        // efetivamente usado (whisper-1 vs gpt-4o-transcribe).
        openAiModel,
      },
    })
    await logAiUsage(
      adminClient,
      user.id,
      'legacy_transcribe',
      Math.ceil(file.size / 1024),
      estimateTranscriptionCost(file.size),
    )

    return withCors(json({ text, transcriptionMode, openAiModel }))
  } catch (error) {
    if (error instanceof Response) {
      return withCors(error)
    }

    console.error(error)
    return withCors(json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500))
  }
})
