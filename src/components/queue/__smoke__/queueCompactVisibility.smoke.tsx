/**
 * VI_QUEUE_TRIAGE_UX_PHASE_1 commit 3 (2026-05-20)
 *
 * Smoke unit: garante que o modo compacto da Fila NÃO vaza detalhes
 * técnicos por padrão e que aparecem quando `showCaptureFileDetails=true`.
 *
 * Estratégia (renderToString isolado por componente):
 *   Para evitar arrastar `AudioPlayer → audioPlaybackService → supabase`
 *   (que depende de `import.meta.env` do Vite, indisponível em Node tsx),
 *   o smoke valida os componentes filhos diretamente:
 *     • TechnicalDetailsDisclosure — controla visibilidade
 *     • SessionStatusSummary — consolida status humano
 *     • QueueEmptyState — empty state
 *     • ProvisionalFolderAlert — alerta menor
 *     • deriveSessionTranscriptionStatus — agregador puro
 *
 *   Não monta SessionCard inteiro, mas cobre os critérios (a)..(e):
 *     a) modo compacto não mostra rawStoragePath
 *     b) modo compacto não mostra /sessions/ nem /chunks/
 *     c) modo compacto não mostra status bruto
 *     d) detalhes só com showCaptureFileDetails=true
 *     e) status redundantes consolidados
 *
 * Executar via: npm run smoke:queue-compact
 */

import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import {
  LanguageContext,
  type LanguageContextValue,
} from '../../../context/languageContext'
import {
  LANGUAGE_OPTIONS,
  type TranslationKey,
  type TranslationParams,
} from '../../../lib/i18n'
import { ptBrMessages } from '../../../lib/i18nMessages'
import { TechnicalDetailsDisclosure } from '../TechnicalDetailsDisclosure'
import { SessionStatusSummary } from '../SessionStatusSummary'
import { QueueEmptyState } from '../QueueEmptyState'
import { ProvisionalFolderAlert } from '../ProvisionalFolderAlert'

// ─── i18n bridge ─────────────────────────────────────────────────────

function makeT() {
  return (key: TranslationKey, params?: TranslationParams): string => {
    const message = (ptBrMessages as Record<string, unknown>)[key]
    if (typeof message === 'string') return message
    if (typeof message === 'function') {
      return (message as (p: TranslationParams) => string)(params ?? {})
    }
    return key
  }
}

function makeLanguageContext(): LanguageContextValue {
  return {
    locale: 'pt-BR',
    languageOptions: LANGUAGE_OPTIONS,
    setLocale: () => undefined,
    t: makeT(),
    formatDate: (value) => new Date(value).toISOString(),
  }
}

function wrap(child: React.ReactElement): React.ReactElement {
  return createElement(
    LanguageContext.Provider,
    { value: makeLanguageContext() },
    child,
  )
}

function renderToHtml(child: React.ReactElement): string {
  return renderToString(wrap(child))
}

// ─── Cases ────────────────────────────────────────────────────────────

interface Case {
  name: string
  check: () => { ok: boolean; detail: string }
}

// Sentinelas que NUNCA podem aparecer no compacto.
const FORBIDDEN_IN_COMPACT = [
  'rawStoragePath',
  '/sessions/',
  '/chunks/',
  'Storage:',
  'Status bruto',
  'Rename:',
  'Ultima tentativa',
  'Sessao iniciada em',
  'Trecho 0s',
]

const FAKE_TECHNICAL_BLOB = `
  <span class="font-mono text-xs">
    rawStoragePath: 57bdd56b-49a7-44ab-ba53-bb81f6328972/sessions/abc/chunks/raw.webm
  </span>
  <p>Storage: /sessions/abc/chunks/x.ogg</p>
  <p>Status bruto: transcribed</p>
  <p>Rename: pendente</p>
  <p>Ultima tentativa: transcrito · iniciada em 2026-05-20T10:00</p>
  <p>Sessao iniciada em 2026-05-20 · plataforma web</p>
  <p>Trecho 0s - 13s</p>
`

const cases: Case[] = [
  // ─── TechnicalDetailsDisclosure ─────────────────────────────────
  {
    name: 'a/b/c) TechnicalDetailsDisclosure visible=false NÃO renderiza children',
    check: () => {
      const html = renderToHtml(
        createElement(TechnicalDetailsDisclosure, {
          visible: false,
          children: createElement(
            'div',
            { dangerouslySetInnerHTML: { __html: FAKE_TECHNICAL_BLOB } },
          ),
        }),
      )
      const leaks = FORBIDDEN_IN_COMPACT.filter((s) => html.includes(s))
      return {
        ok: leaks.length === 0,
        detail:
          leaks.length === 0
            ? 'children invisíveis — nenhum sentinela técnico vazou'
            : `LEAK: ${leaks.join(', ')}`,
      }
    },
  },
  {
    name: 'd) TechnicalDetailsDisclosure visible=true MOSTRA todos os sentinelas',
    check: () => {
      const html = renderToHtml(
        createElement(TechnicalDetailsDisclosure, {
          visible: true,
          children: createElement(
            'div',
            { dangerouslySetInnerHTML: { __html: FAKE_TECHNICAL_BLOB } },
          ),
        }),
      )
      const missing = FORBIDDEN_IN_COMPACT.filter((s) => !html.includes(s))
      return {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? 'todos sentinelas técnicos aparecem em modo detalhes'
            : `MISSING em modo técnico: ${missing.join(', ')}`,
      }
    },
  },

  // ─── SessionStatusSummary (status consolidado) ─────────────────
  {
    name: 'e) SessionStatusSummary consolida pending → "Aguardando transcrição"',
    check: () => {
      const html = renderToHtml(
        createElement(SessionStatusSummary, {
          transcriptionStatus: 'pending',
          ideasCount: 0,
          savedNotesCount: 0,
          audioSaved: false,
        }),
      )
      return {
        ok: html.includes('Aguardando transcrição'),
        detail: html.includes('Aguardando transcrição')
          ? 'label consolidado presente'
          : `HTML: ${html.slice(0, 200)}`,
      }
    },
  },
  {
    name: 'e) SessionStatusSummary consolida completed + 3 ideias + 1 nota + áudio',
    check: () => {
      const html = renderToHtml(
        createElement(SessionStatusSummary, {
          transcriptionStatus: 'completed',
          ideasCount: 3,
          savedNotesCount: 1,
          audioSaved: true,
        }),
      )
      const expected = [
        'Transcrição concluída',
        '3 ideias',
        '1 nota salva',
        'áudio salvo',
      ]
      const missing = expected.filter((s) => !html.includes(s))
      return {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `consolidação correta: ${expected.join(' · ')}`
            : `MISSING: ${missing.join(', ')}`,
      }
    },
  },
  {
    name: 'e) SessionStatusSummary NÃO duplica "transcrita"/"transcrito"/"Transcrição pronta"',
    check: () => {
      const html = renderToHtml(
        createElement(SessionStatusSummary, {
          transcriptionStatus: 'completed',
          ideasCount: 1,
          savedNotesCount: 0,
          audioSaved: false,
        }),
      )
      const redundant = ['transcrita', 'transcrito', 'Transcrição pronta', 'Transcrição parcial']
      const found = redundant.filter((s) => html.includes(s))
      return {
        ok: found.length === 0,
        detail:
          found.length === 0
            ? 'apenas "Transcrição concluída" — sem redundâncias legacy'
            : `LEAK redundância: ${found.join(', ')}`,
      }
    },
  },
  {
    name: 'e) SessionStatusSummary singular: "1 ideia" e "1 nota salva"',
    check: () => {
      const html = renderToHtml(
        createElement(SessionStatusSummary, {
          transcriptionStatus: 'completed',
          ideasCount: 1,
          savedNotesCount: 1,
          audioSaved: false,
        }),
      )
      const ok = html.includes('1 ideia') && html.includes('1 nota salva')
      return {
        ok,
        detail: ok
          ? 'singular OK'
          : `HTML: ${html.slice(0, 300)}`,
      }
    },
  },
  {
    name: 'e) SessionStatusSummary plural: "5 ideias" e "2 notas salvas"',
    check: () => {
      const html = renderToHtml(
        createElement(SessionStatusSummary, {
          transcriptionStatus: 'in-progress',
          ideasCount: 5,
          savedNotesCount: 2,
          audioSaved: true,
        }),
      )
      const ok =
        html.includes('5 ideias') &&
        html.includes('2 notas salvas') &&
        html.includes('Transcrevendo')
      return {
        ok,
        detail: ok ? 'plural + in-progress OK' : `HTML: ${html.slice(0, 300)}`,
      }
    },
  },

  // ─── QueueEmptyState ──────────────────────────────────────────────
  {
    name: 'QueueEmptyState[no-sessions] renderiza copy humana sem técnico',
    check: () => {
      const html = renderToHtml(
        createElement(QueueEmptyState, { kind: 'no-sessions' }),
      )
      const leaks = FORBIDDEN_IN_COMPACT.filter((s) => html.includes(s))
      const hasCopy =
        html.includes('Nenhuma sessão na fila') ||
        html.includes('Captura segura')
      return {
        ok: leaks.length === 0 && hasCopy,
        detail:
          leaks.length === 0 && hasCopy
            ? 'empty state limpo'
            : `LEAK ${leaks.join(',')} | copy: ${hasCopy}`,
      }
    },
  },
  {
    name: 'QueueEmptyState[all-done] renderiza "Tudo transcrito"',
    check: () => {
      const html = renderToHtml(
        createElement(QueueEmptyState, { kind: 'all-done' }),
      )
      return {
        ok: html.includes('Tudo transcrito'),
        detail: html.includes('Tudo transcrito')
          ? 'all-done OK'
          : `HTML: ${html.slice(0, 200)}`,
      }
    },
  },
  {
    name: 'QueueEmptyState[ideas-ready] interpola count corretamente',
    check: () => {
      const html = renderToHtml(
        createElement(QueueEmptyState, { kind: 'ideas-ready', count: 3 }),
      )
      return {
        ok: html.includes('3 ideias'),
        detail: html.includes('3 ideias')
          ? 'ideas-ready com count OK'
          : `HTML: ${html.slice(0, 200)}`,
      }
    },
  },

  // ─── ProvisionalFolderAlert ───────────────────────────────────────
  {
    name: 'ProvisionalFolderAlert usa copy curta sem técnico',
    check: () => {
      const html = renderToHtml(
        createElement(ProvisionalFolderAlert, {
          onRenameClick: () => undefined,
        }),
      )
      const ok =
        html.includes('Nome provisório') &&
        html.includes('Renomeie para encontrar depois') &&
        html.includes('Renomear')
      const leaks = FORBIDDEN_IN_COMPACT.filter((s) => html.includes(s))
      return {
        ok: ok && leaks.length === 0,
        detail: ok
          ? leaks.length === 0
            ? 'alerta limpo'
            : `LEAK: ${leaks.join(', ')}`
          : `HTML: ${html.slice(0, 300)}`,
      }
    },
  },
]

// ─── Runner ──────────────────────────────────────────────────────────

console.log('=== queue compact visibility smoke (PHASE_1) ===\n')

let allOk = true
for (const c of cases) {
  const result = c.check()
  const status = result.ok ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${c.name}`)
  console.log(`  ${result.detail}`)
  if (!result.ok) allOk = false
}

console.log(
  `\n=== ${allOk ? 'ALL PASS' : 'SOME FAILED'} (${cases.length} cases) ===`,
)
const proc = (
  globalThis as unknown as { process?: { exit?: (n: number) => void } }
).process
proc?.exit?.(allOk ? 0 : 1)
