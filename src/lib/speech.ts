export interface SpeechRecognitionResult {
  transcript: string
  isFinal: boolean
}

type SpeechRecognitionEvent = {
  results: {
    [index: number]: {
      [index: number]: { transcript: string }
      isFinal: boolean
    }
    length: number
  }
  resultIndex: number
}

export function createSpeechRecognition(
  onResult: (result: SpeechRecognitionResult) => void,
  onError: (error: string) => void,
  onEnd: () => void,
) {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  if (!SpeechRecognition) {
    onError('Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.')
    return null
  }

  const recognition = new SpeechRecognition()
  recognition.lang = 'pt-BR'
  recognition.continuous = true
  recognition.interimResults = true

  // Track which result indices have already been processed as final
  const processedFinals = new Set<number>()

  recognition.onresult = (event: SpeechRecognitionEvent) => {
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

  recognition.onerror = (event: any) => {
    if (event.error === 'no-speech') return
    onError(`Erro no reconhecimento: ${event.error}`)
  }

  recognition.onend = onEnd

  return recognition
}

export function isSpeechRecognitionSupported(): boolean {
  return !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  )
}
