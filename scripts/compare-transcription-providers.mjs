#!/usr/bin/env node
/**
 * VI_TRANSCRIPTION_PROVIDER_VERBATIM_R3 (2026-05-17)
 *
 * CLI para A/B de providers STT em modo verbatim. Roda contra o
 * endpoint `/transcribe-experimental` em produção.
 *
 * Uso:
 *   node scripts/compare-transcription-providers.mjs \
 *     --endpoint https://uhzwqhaxnodtshlvvikt.supabase.co/functions/v1/transcribe-experimental \
 *     --token <SUPABASE_ACCESS_TOKEN> \
 *     --audio audio_A_zambuteco.webm:A \
 *     --audio audio_B_numeros.webm:B \
 *     --audio audio_C_repeticoes.webm:C \
 *     --audio audio_D_informal.webm:D \
 *     [--providers openai-whisper-1,deepgram,assemblyai]
 *     [--mode verbatim] [--language pt]
 *     [--out report.md]
 *
 * Como obter o token:
 *   Logado no app web (voiceideas.vercel.app), abrir DevTools console e:
 *     JSON.parse(localStorage.getItem(
 *       Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
 *     )).access_token
 *
 * O script gera:
 *   - report.md (matriz Markdown legível)
 *   - report.json (matriz completa para processamento)
 *
 * Fixtures recomendadas (gravar pelo iPad/iPhone, pt-BR claro):
 *   A. "O projeto se chama Zambuteco e isso não deve ser corrigido."
 *   B. "O código é 47, 13, 902, e o valor é 1.250 reais."
 *   C. "Eu eu eu acho que talvez talvez isso funcione."
 *   D. "Tipo assim, eu tava meio sem saber o que fazer, né?"
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

function parseArgs(argv) {
  const args = {
    endpoint: '',
    token: '',
    audios: [], // [{ path, label }]
    providers: ['openai-whisper-1', 'deepgram', 'assemblyai'],
    mode: 'verbatim',
    language: 'pt',
    out: 'report.md',
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--endpoint') args.endpoint = argv[++i]
    else if (a === '--token') args.token = argv[++i]
    else if (a === '--audio') {
      const v = argv[++i]
      const [path, labelMaybe] = v.split(':')
      args.audios.push({ path, label: labelMaybe ?? basename(path) })
    } else if (a === '--providers') args.providers = argv[++i].split(',').map((s) => s.trim())
    else if (a === '--mode') args.mode = argv[++i]
    else if (a === '--language') args.language = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log(`compare-transcription-providers — see header comment for full usage`)
      process.exit(0)
    }
  }
  if (!args.endpoint || !args.token || args.audios.length === 0) {
    console.error(
      'Uso: --endpoint <url> --token <jwt> --audio <path>[:<label>] [--audio ...]\n' +
        '     [--providers ...] [--mode verbatim|natural] [--language pt|en|es] [--out report.md]\n' +
        'Veja o header do arquivo para mais detalhes.',
    )
    process.exit(1)
  }
  return args
}

function detectMime(path) {
  const p = path.toLowerCase()
  if (p.endsWith('.webm')) return 'audio/webm'
  if (p.endsWith('.m4a')) return 'audio/m4a'
  if (p.endsWith('.mp4')) return 'audio/mp4'
  if (p.endsWith('.ogg')) return 'audio/ogg'
  if (p.endsWith('.wav')) return 'audio/wav'
  if (p.endsWith('.mp3')) return 'audio/mpeg'
  return 'audio/webm'
}

async function runProvider({ endpoint, token, audioPath, provider, mode, language }) {
  const audioBuf = await readFile(audioPath)
  const mime = detectMime(audioPath)
  const fileName = basename(audioPath)

  const form = new FormData()
  form.append('file', new Blob([audioBuf], { type: mime }), fileName)
  form.append('provider', provider)
  form.append('transcription_mode', mode)
  form.append('language', language)

  const startedAt = Date.now()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const elapsed = Date.now() - startedAt
  const body = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = { raw: body.slice(0, 500) }
  }
  if (!res.ok) {
    return {
      provider,
      ok: false,
      status: res.status,
      error: parsed?.error ?? `HTTP ${res.status}`,
      latencyClientMs: elapsed,
      text: '',
      latencyServerMs: parsed?.latencyMs ?? null,
      estimatedCostUsd: parsed?.estimatedCostUsd ?? null,
      model: parsed?.model ?? null,
    }
  }
  return {
    provider,
    ok: true,
    status: res.status,
    error: null,
    latencyClientMs: elapsed,
    text: parsed?.text ?? '',
    latencyServerMs: parsed?.latencyMs ?? null,
    estimatedCostUsd: parsed?.estimatedCostUsd ?? null,
    model: parsed?.model ?? null,
  }
}

// ─── Critérios de avaliação por label ─────────────────────────────────

/**
 * Cada áudio (A/B/C/D) tem um conjunto de checks. Cada check retorna
 * `true` se o texto retornado preservou o aspecto esperado.
 *
 * NÃO comparamos exatamente — usamos heurísticas robustas a variações
 * pequenas de transcrição. Falso negativo é preferível a falso positivo
 * (queremos detectar falhas reais).
 */
function evaluateText(label, text) {
  const lower = text.toLowerCase()
  const checks = {}

  if (label === 'A' || label.toUpperCase().includes('ZAMBUTECO')) {
    checks.preservedInventedWord_Zambuteco = /zambuteco/i.test(text)
    checks.didNotCorrectTo_Zamboteco = !/zamboteco/i.test(text)
  }
  if (label === 'B' || label.toUpperCase().includes('NUMERO')) {
    // Aceita "47, 13, 902" OU "47, 13, 902, e o valor" — exige vírgulas
    // entre os 3 números E não pode ter "4713902" colado.
    checks.preservedNumbersSeparated_47_13_902 =
      /\b47\s*[,.]\s*13\s*[,.]\s*902\b/.test(text)
    checks.didNotConcatenate_4713902 = !/\b4713902\b/.test(text)
    // Valor pode aparecer como "1.250", "1250", "mil duzentos e cinquenta" —
    // qualquer um aceita, mas marcamos o que apareceu.
    checks.value_form_observed = /1\.?250|mil duzentos e cinquenta/i.test(lower)
      ? text.match(/1\.?250|mil duzentos e cinquenta/i)?.[0]
      : null
  }
  if (label === 'C' || label.toUpperCase().includes('REPET')) {
    // Conta ocorrências de "eu" consecutivas e de "talvez" consecutivas.
    const euCount = (text.match(/\b(eu)(?:[,.\s]+(eu))+/gi) || [])
      .map((m) => (m.match(/\beu\b/gi) || []).length)
      .reduce((a, b) => Math.max(a, b), 0)
    const talvezCount = (text.match(/\b(talvez)(?:[,.\s]+(talvez))+/gi) || [])
      .map((m) => (m.match(/\btalvez\b/gi) || []).length)
      .reduce((a, b) => Math.max(a, b), 0)
    checks.repeatedEu_count = euCount
    checks.preservedAllThreeEu = euCount >= 3
    checks.repeatedTalvez_count = talvezCount
    checks.preservedBothTalvez = talvezCount >= 2
  }
  if (label === 'D' || label.toUpperCase().includes('INFORMAL')) {
    checks.preservedTipoAssim = /\btipo assim\b/i.test(text)
    checks.preservedNe = /\bn[eé]\b\s*[.?!]?$|n[eé][.?!\s]/i.test(text)
    checks.preservedTava_orTavaMeio = /\btava\b/i.test(text)
    // Não pode ter virado "Eu estava sem saber" (forma editorial)
    checks.didNotEditorialize_estava = !/\beu estava\b/i.test(text)
  }

  return checks
}

// ─── Render report ───────────────────────────────────────────────────

function rowFromResult(label, result, checks) {
  return {
    label,
    provider: result.provider,
    model: result.model,
    ok: result.ok,
    text: result.text,
    error: result.error,
    latencyClientMs: result.latencyClientMs,
    latencyServerMs: result.latencyServerMs,
    estimatedCostUsd: result.estimatedCostUsd,
    checks,
  }
}

function renderMarkdown(rows, args) {
  const lines = []
  lines.push(`# Provider Verbatim Comparison — VI_TRANSCRIPTION_PROVIDER_VERBATIM_R3`)
  lines.push(``)
  lines.push(`- Endpoint: \`${args.endpoint}\``)
  lines.push(`- Mode: \`${args.mode}\` · Language: \`${args.language}\``)
  lines.push(`- Providers tested: \`${args.providers.join(', ')}\``)
  lines.push(`- Audios: ${args.audios.map((a) => `\`${a.label}\``).join(', ')}`)
  lines.push(``)

  const byLabel = new Map()
  for (const r of rows) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, [])
    byLabel.get(r.label).push(r)
  }

  for (const [label, providerRows] of byLabel) {
    lines.push(`## Áudio ${label}`)
    lines.push(``)
    lines.push(`| Provider | Modelo | OK | Latência (ms client / server) | Custo (USD) | Texto |`)
    lines.push(`|---|---|---|---|---|---|`)
    for (const r of providerRows) {
      const text = r.ok
        ? '`' + (r.text || '').replace(/`/g, "'").slice(0, 200) + '`'
        : `❌ ${r.error}`
      lines.push(
        `| ${r.provider} | ${r.model ?? '-'} | ${r.ok ? '✅' : '❌'} | ${r.latencyClientMs} / ${r.latencyServerMs ?? '-'} | ${r.estimatedCostUsd ?? '-'} | ${text} |`,
      )
    }
    lines.push(``)
    lines.push(`### Checks por provider (Áudio ${label})`)
    lines.push(``)
    const allCheckKeys = new Set()
    for (const r of providerRows) Object.keys(r.checks || {}).forEach((k) => allCheckKeys.add(k))
    const checkKeys = Array.from(allCheckKeys)
    if (checkKeys.length > 0) {
      lines.push(`| Provider | ${checkKeys.join(' | ')} |`)
      lines.push(`|${'---|'.repeat(checkKeys.length + 1)}`)
      for (const r of providerRows) {
        const vals = checkKeys.map((k) => {
          const v = r.checks?.[k]
          if (typeof v === 'boolean') return v ? '✅' : '❌'
          if (v === null || v === undefined) return '-'
          return String(v)
        })
        lines.push(`| ${r.provider} | ${vals.join(' | ')} |`)
      }
    } else {
      lines.push(`(sem checks aplicáveis para este áudio)`)
    }
    lines.push(``)
  }

  // Recomendação automática simples: provider com mais checks booleanos true.
  lines.push(`## Score consolidado`)
  lines.push(``)
  const scoreByProvider = new Map()
  for (const r of rows) {
    if (!r.ok || !r.checks) continue
    let score = 0
    let total = 0
    for (const v of Object.values(r.checks)) {
      if (typeof v === 'boolean') {
        total += 1
        if (v) score += 1
      }
    }
    const acc = scoreByProvider.get(r.provider) || { score: 0, total: 0 }
    acc.score += score
    acc.total += total
    scoreByProvider.set(r.provider, acc)
  }
  lines.push(`| Provider | Checks booleanos PASS / Total |`)
  lines.push(`|---|---|`)
  let bestProvider = null
  let bestRatio = -1
  for (const [provider, { score, total }] of scoreByProvider) {
    const ratio = total > 0 ? score / total : 0
    lines.push(`| ${provider} | ${score} / ${total} (${(ratio * 100).toFixed(0)}%) |`)
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestProvider = provider
    }
  }
  lines.push(``)
  lines.push(`**Provider com maior score:** \`${bestProvider ?? 'n/a'}\` (${(bestRatio * 100).toFixed(0)}%)`)
  lines.push(``)
  lines.push(`> Critério: cada check booleano TRUE conta 1 ponto. Custos e latência são informativos — não entram no score. Análise final fica com Gian, considerando trade-offs (custo, latência, robustez em produção).`)
  return lines.join('\n')
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)
  console.error(
    `[compare] endpoint=${args.endpoint}\n` +
      `[compare] providers=${args.providers.join(',')}  mode=${args.mode}  language=${args.language}\n` +
      `[compare] audios=${args.audios.length}\n`,
  )

  const rows = []
  for (const { path: audioPath, label } of args.audios) {
    for (const provider of args.providers) {
      console.error(`[compare] running ${provider} on ${label} (${audioPath}) ...`)
      try {
        const result = await runProvider({
          endpoint: args.endpoint,
          token: args.token,
          audioPath,
          provider,
          mode: args.mode,
          language: args.language,
        })
        const checks = result.ok ? evaluateText(label, result.text) : {}
        rows.push(rowFromResult(label, result, checks))
        if (result.ok) {
          console.error(
            `  → OK in ${result.latencyClientMs}ms (server ${result.latencyServerMs}ms) — len=${result.text.length}`,
          )
        } else {
          console.error(`  → FAIL ${result.status}: ${result.error}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`  → THROW: ${message}`)
        rows.push({
          label,
          provider,
          ok: false,
          error: message,
          latencyClientMs: 0,
          latencyServerMs: null,
          estimatedCostUsd: null,
          text: '',
          model: null,
          checks: {},
        })
      }
    }
  }

  const md = renderMarkdown(rows, args)
  await writeFile(args.out, md, 'utf-8')
  const jsonOut = args.out.replace(/\.md$/i, '.json')
  await writeFile(jsonOut, JSON.stringify({ args: { ...args, token: '<redacted>' }, rows }, null, 2), 'utf-8')
  console.error(`\n[compare] wrote ${args.out} and ${jsonOut}`)
}

main().catch((err) => {
  console.error('[compare] fatal:', err)
  process.exit(1)
})
