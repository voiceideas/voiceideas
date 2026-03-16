import { supabase, isSupabaseConfigured } from './supabase'
import { sanitizeTranscript } from './speech'

interface TranscriptionResponse {
  text?: string
  error?: string
}

function mapTranscriptionErrorMessage(message: string): string {
  if (message.includes('404')) {
    return 'A funcao de transcricao ainda nao foi publicada no Supabase.'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Nao foi possivel enviar o audio para transcricao. Verifique sua conexao.'
  }

  return message || 'Falha ao transcrever o audio.'
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('m4a')) return 'm4a'
  return 'webm'
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nao configurado para transcrever audio.')
  }

  const mimeType = blob.type || 'audio/webm'
  const extension = getFileExtension(mimeType)
  const formData = new FormData()

  formData.append('file', blob, `voice-note.${extension}`)
  formData.append('language', 'pt')
  formData.append(
    'prompt',
    'Transcreva em portugues brasileiro, com pontuacao natural, sem repetir trechos. O audio e uma nota de voz curta de uma unica pessoa.',
  )

  const { data, error } = await supabase.functions.invoke<TranscriptionResponse>('transcribe', {
    body: formData,
  })

  if (error) {
    throw new Error(mapTranscriptionErrorMessage(error.message || ''))
  }

  const text = sanitizeTranscript(data?.text || '')
  if (!text) {
    throw new Error('Nao foi possivel entender o audio gravado.')
  }

  return text
}
