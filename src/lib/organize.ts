import type { OrganizationType, OrganizedContent } from '../types/database'

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
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('Chave da OpenAI não configurada. Adicione VITE_OPENAI_API_KEY no arquivo .env')
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

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Organize as seguintes notas como "${TYPE_LABELS[type]}":\n\n${combinedText}` },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error?.error?.message || `Erro da OpenAI: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('Resposta vazia da IA')
  }

  try {
    // Limpar possíveis code blocks na resposta
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      title: parsed.title || `${TYPE_LABELS[type]} - ${new Date().toLocaleDateString('pt-BR')}`,
      content: parsed.content,
    }
  } catch {
    throw new Error('Erro ao processar resposta da IA. Tente novamente.')
  }
}

export { TYPE_LABELS }
