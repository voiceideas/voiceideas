export interface SpeechRecognitionResult {
  transcript: string
  isFinal: boolean
}

export interface SpeechRecognitionOptions {
  continuous?: boolean
}

type SpeechRecognitionAlternative = {
  transcript: string
}

type BrowserSpeechRecognitionResult = {
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

type BrowserSpeechRecognitionResultList = {
  [index: number]: BrowserSpeechRecognitionResult
  length: number
}

type BrowserSpeechRecognitionEvent = Event & {
  results: BrowserSpeechRecognitionResultList
  resultIndex: number
}

type BrowserSpeechRecognitionErrorEvent = Event & {
  error: string
}

export interface BrowserSpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onend: (() => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionInstance

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function splitTranscript(text: string): string[] {
  return normalizeTranscript(text).split(' ').filter(Boolean)
}

function mapSpeechRecognitionError(error: string): string {
  switch (error) {
    case 'audio-capture':
      return 'Nao foi possivel acessar o microfone. Verifique as permissoes do navegador.'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permita o uso do microfone para gravar ideias por voz.'
    case 'aborted':
      return 'A gravacao foi interrompida. Toque novamente para continuar.'
    case 'network':
      return 'A transcricao falhou por instabilidade de rede. Tente novamente.'
    default:
      return `Erro no reconhecimento: ${error}`
  }
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function mergeTranscriptSegments(base: string, incoming: string): string {
  const normalizedBase = normalizeTranscript(base)
  const normalizedIncoming = normalizeTranscript(incoming)

  if (!normalizedIncoming) return normalizedBase
  if (!normalizedBase) return normalizedIncoming
  if (normalizedBase === normalizedIncoming) return normalizedBase
  if (normalizedBase.endsWith(normalizedIncoming)) return normalizedBase
  if (normalizedIncoming.startsWith(normalizedBase)) return normalizedIncoming

  const baseWords = splitTranscript(normalizedBase)
  const incomingWords = splitTranscript(normalizedIncoming)
  const maxOverlap = Math.min(baseWords.length, incomingWords.length)

  for (let size = maxOverlap; size > 0; size -= 1) {
    const baseSuffix = baseWords.slice(-size).join(' ')
    const incomingPrefix = incomingWords.slice(0, size).join(' ')

    if (baseSuffix === incomingPrefix) {
      return [...baseWords, ...incomingWords.slice(size)].join(' ')
    }
  }

  return `${normalizedBase} ${normalizedIncoming}`.trim()
}

export function stripTranscriptPrefix(base: string, incoming: string): string {
  const normalizedBase = normalizeTranscript(base)
  const normalizedIncoming = normalizeTranscript(incoming)

  if (!normalizedIncoming || !normalizedBase) return normalizedIncoming
  if (normalizedIncoming.startsWith(normalizedBase)) {
    return normalizedIncoming.slice(normalizedBase.length).trim()
  }

  const baseWords = splitTranscript(normalizedBase)
  const incomingWords = splitTranscript(normalizedIncoming)
  const maxOverlap = Math.min(baseWords.length, incomingWords.length)

  for (let size = maxOverlap; size > 0; size -= 1) {
    const baseSuffix = baseWords.slice(-size).join(' ')
    const incomingPrefix = incomingWords.slice(0, size).join(' ')

    if (baseSuffix === incomingPrefix) {
      return incomingWords.slice(size).join(' ')
    }
  }

  return normalizedIncoming
}

export function createSpeechRecognition(
  onResult: (result: SpeechRecognitionResult) => void,
  onError: (error: string) => void,
  onEnd: () => void,
  options: SpeechRecognitionOptions = {},
) {
  const SpeechRecognition = getSpeechRecognitionConstructor()

  if (!SpeechRecognition) {
    onError('Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.')
    return null
  }

  const recognition = new SpeechRecognition()
  recognition.lang = 'pt-BR'
  recognition.continuous = options.continuous ?? true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  // Track which result indices have already been processed as final
  const processedFinals = new Set<number>()

  recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]

      // Skip results we already processed as final
      if (processedFinals.has(i)) continue

      if (result.isFinal) {
        processedFinals.add(i)
      }

      onResult({
        transcript: result[0].transcript,
        isFinal: result.isFinal,
      })
    }
  }

  recognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
    if (event.error === 'no-speech') return
    onError(mapSpeechRecognitionError(event.error))
  }

  recognition.onend = onEnd

  return recognition
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null
}
