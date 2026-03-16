import type { OrganizationType, OrganizedContent } from '../types/database'
import { supabase, isSupabaseConfigured } from './supabase'

const TYPE_LABELS: Record<OrganizationType, string> = {
  topicos: 'Tópicos',
  plano: 'Plano de Ação',
  roteiro: 'Roteiro',
  mapa: 'Mapa de Ideias',
}

const TYPE_PROMPTS: Record<OrganizationType, string> = {
  topicos: `Agrupe as seguintes ideias por tema. Para cada grupo, crie um título claro e liste os itens relacionados. Identifique padrões e conexões entre as ideias.`,
  plano: `Crie um plano de ação organizado com etapas claras, ordenadas por prioridade. Para cada etapa, inclua uma descrição objetiva do que precisa ser feito.`,
  roteiro: `Organize as ideias em uma sequência lógica e temporal, como um roteiro. Crie seções que fluam naturalmente de uma para outra, formando uma narrativa coerente.`,
  mapa: `Identifique os conceitos principais e mapeie as conexões, dependências e relações entre eles. Agrupe por áreas temáticas e mostre como se interconectam.`,
}

export async function organizeWithAI(
  noteTexts: string[],
  type: OrganizationType,
): Promise<{ title: string; content: OrganizedContent }> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase nao configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env')
  }

  const combinedText = noteTexts
    .map((text, i) => `[Nota ${i + 1}]: ${text}`)
    .join('\n\n')

  const systemPrompt = `Você é um assistente que organiza ideias e notas em português brasileiro.
${TYPE_PROMPTS[type]}

IMPORTANTE: Responda APENAS com JSON válido no formato abaixo, sem markdown, sem code blocks:
{
  "title": "Título descritivo do resultado",
  "content": {
    "sections": [
      {
        "heading": "Nome da seção",
        "items": ["Item 1", "Item 2", "Item 3"]
      }
    ],
    "summary": "Resumo geral opcional"
  }
}`

  const { data, error } = await supabase.functions.invoke<{
    title: string
    content: OrganizedContent
    error?: string
  }>('organize', {
    body: {
      texts: combinedText,
      type,
      typeLabel: TYPE_LABELS[type],
      systemPrompt,
    },
  })

  if (error) {
    throw new Error(error.message || 'Erro ao organizar notas com a Edge Function.')
  }

  if (!data?.title || !data?.content) {
    throw new Error('Resposta vazia da IA')
  }

  return {
    title: data.title || `${TYPE_LABELS[type]} - ${new Date().toLocaleDateString('pt-BR')}`,
    content: data.content,
  }
}

export { TYPE_LABELS }
