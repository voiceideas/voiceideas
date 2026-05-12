#!/usr/bin/env node
// VI_I18N.AUDIT.1 (2026-05-12):
//   Audita o catálogo de tradução em src/lib/i18nMessages.ts.
//   - Garante paridade de chaves entre pt-BR, en e es.
//   - Detecta uso de fallback silencioso (spread `...enMessages` etc.) em
//     qualquer locale, que mascara chaves faltando.
//   - Detecta resíduos PT em locales não-PT (heurística por palavras-âncora).
//
//   Falha (exit 1) se encontrar discrepâncias estruturais ou PT residual.
//   Pode ser rodado isolado via `npm run audit:i18n`.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'src', 'lib', 'i18nMessages.ts')

const LOCALES = ['ptBrMessages', 'enMessages', 'esMessages']

const src = await readFile(sourcePath, 'utf8')

// Extract each locale block (start `export const X = {` até `} as const satisfies`).
// O bloco pt-BR usa `Record<string, TranslationMessage>` (porque é onde TranslationKey é definido);
// en/es usam `Record<TranslationKey, TranslationMessage>`. Aceitamos ambas as variantes.
function extractLocaleBlock(name) {
  const startMarker = `export const ${name} = {`
  const startIdx = src.indexOf(startMarker)
  if (startIdx < 0) return null
  const braceOpen = src.indexOf('{', startIdx)
  // Find next `} as const satisfies Record<...,...>` after the brace
  const re = /\}\s+as\s+const\s+satisfies\s+Record<[^>]+>/g
  re.lastIndex = braceOpen
  const m = re.exec(src)
  if (!m) return null
  return src.slice(braceOpen + 1, m.index)
}

function extractKeysWithValues(body) {
  // Walk through and collect top-level entries: keys + raw value source.
  const entries = {}
  let pos = 0
  while (pos < body.length) {
    // Skip whitespace
    while (pos < body.length && /[\s\n]/.test(body[pos])) pos++
    if (pos >= body.length) break
    // Skip comments
    if (body.slice(pos, pos + 2) === '//') {
      while (pos < body.length && body[pos] !== '\n') pos++
      continue
    }
    if (body.slice(pos, pos + 2) === '/*') {
      const close = body.indexOf('*/', pos + 2)
      if (close < 0) break
      pos = close + 2
      continue
    }
    // Detect spread (`...something`) — bad practice, flag.
    if (body.slice(pos, pos + 3) === '...') {
      // Read until comma or newline
      const spreadStart = pos
      while (pos < body.length && body[pos] !== ',' && body[pos] !== '\n') pos++
      const spreadExpr = body.slice(spreadStart, pos).trim()
      entries['__spread__'] = entries['__spread__'] || []
      entries['__spread__'].push(spreadExpr)
      if (body[pos] === ',') pos++
      continue
    }
    // Expect single-quoted key
    if (body[pos] !== "'") {
      // unknown — skip line
      while (pos < body.length && body[pos] !== '\n') pos++
      continue
    }
    pos++ // consume opening '
    const keyStart = pos
    while (pos < body.length && body[pos] !== "'") {
      if (body[pos] === '\\') pos++
      pos++
    }
    const key = body.slice(keyStart, pos)
    pos++ // closing '
    while (pos < body.length && /\s/.test(body[pos])) pos++
    if (body[pos] !== ':') {
      while (pos < body.length && body[pos] !== '\n') pos++
      continue
    }
    pos++
    while (pos < body.length && /\s/.test(body[pos])) pos++
    // Balanced read of value until top-level comma
    const valStart = pos
    let parenDepth = 0, braceDepth = 0, bracketDepth = 0
    let inStr = false, strChar = null, inBacktick = false, templateDepth = 0
    while (pos < body.length) {
      const c = body[pos]
      if (inStr) {
        if (c === '\\') { pos += 2; continue }
        if (c === strChar) { inStr = false; strChar = null }
        pos++; continue
      }
      if (inBacktick) {
        if (c === '\\') { pos += 2; continue }
        if (c === '`' && templateDepth === 0) { inBacktick = false; pos++; continue }
        if (c === '$' && body[pos + 1] === '{') { templateDepth++; pos += 2; continue }
        if (c === '}' && templateDepth > 0) { templateDepth--; pos++; continue }
        pos++; continue
      }
      if (c === "'" || c === '"') { inStr = true; strChar = c; pos++; continue }
      if (c === '`') { inBacktick = true; pos++; continue }
      if (c === '(') parenDepth++
      else if (c === ')') parenDepth--
      else if (c === '{') braceDepth++
      else if (c === '}') braceDepth--
      else if (c === '[') bracketDepth++
      else if (c === ']') bracketDepth--
      else if (c === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) break
      pos++
    }
    const value = body.slice(valStart, pos).trim()
    entries[key] = value
    if (body[pos] === ',') pos++
  }
  return entries
}

const data = {}
for (const name of LOCALES) {
  const body = extractLocaleBlock(name)
  if (!body) {
    console.error(`[audit-i18n] FAIL: bloco ${name} não encontrado em ${sourcePath}`)
    process.exit(1)
  }
  data[name] = extractKeysWithValues(body)
}

const issues = []

// ─── 1) Spread fallback ────────────────────────────────────────────
for (const name of LOCALES) {
  const spreads = data[name].__spread__
  if (spreads && spreads.length) {
    issues.push({
      kind: 'spread-fallback',
      locale: name,
      details: spreads,
      message: `Locale ${name} usa spread (${spreads.join(', ')}) — pode mascarar chaves faltando.`,
    })
  }
}

// ─── 2) Paridade de chaves ────────────────────────────────────────
const ptKeys = new Set(Object.keys(data.ptBrMessages).filter(k => k !== '__spread__'))
for (const name of LOCALES) {
  const keys = new Set(Object.keys(data[name]).filter(k => k !== '__spread__'))
  // Missing keys = present in pt-BR mas não no locale
  const missing = [...ptKeys].filter(k => !keys.has(k))
  // Extra keys = no locale mas não em pt-BR (excess)
  const extra = [...keys].filter(k => !ptKeys.has(k))
  if (missing.length) {
    issues.push({
      kind: 'missing-keys',
      locale: name,
      count: missing.length,
      sample: missing.slice(0, 8),
      message: `Locale ${name}: ${missing.length} chave${missing.length === 1 ? '' : 's'} ausente${missing.length === 1 ? '' : 's'} em relação a pt-BR.`,
    })
  }
  if (extra.length) {
    issues.push({
      kind: 'extra-keys',
      locale: name,
      count: extra.length,
      sample: extra.slice(0, 8),
      message: `Locale ${name}: ${extra.length} chave${extra.length === 1 ? '' : 's'} extra${extra.length === 1 ? '' : 's'} (sem correspondente em pt-BR).`,
    })
  }
}

// ─── 3) Locales não-PT espelhando string raw do pt-BR ─────────────
// (Sinaliza tradução faltando: o desenvolvedor copiou o texto PT mas esqueceu de traduzir.)
const nonPtLocales = ['enMessages', 'esMessages']
for (const name of nonPtLocales) {
  const sameAsPt = []
  for (const key of ptKeys) {
    const ptVal = data.ptBrMessages[key]
    const locVal = data[name][key]
    if (locVal === undefined) continue
    if (locVal === ptVal && typeof ptVal === 'string' && ptVal.length > 10) {
      sameAsPt.push(key)
    }
  }
  if (sameAsPt.length) {
    issues.push({
      kind: 'identical-to-pt',
      locale: name,
      count: sameAsPt.length,
      sample: sameAsPt.slice(0, 50),  // mostrar até 50 para revisão manual
      message: `Locale ${name}: ${sameAsPt.length} valor${sameAsPt.length === 1 ? '' : 'es'} idêntico${sameAsPt.length === 1 ? '' : 's'} a pt-BR (revisar — algumas palavras/marcas naturalmente coincidem).`,
    })
  }
}

// ─── 4) Resíduos PT em locales não-PT (heurística) ────────────────
// Marcadores fortes: palavras que NÃO existem em ES/EN normais.
const PT_RESIDUAL_TOKENS = [
  // Articles/preps PT
  ' não ', ' Não ', '`Não ', /\bNão\b\s/, /^Não /,
  ' são ', ' São ',
  // PT-specific verbs
  ' pode ', ' Pode ', ' podem ',
  ' você', ' Você',
  ' lhe ', ' lhes ',
  // PT-specific nouns
  'sessão', 'Sessão',
  ' Ideia ', ' Ideias ',
  // PT past tense
  ' foi ', ' Foi ', 'ficou', 'ficaram', 'falhou', 'gerou',
  // PT specific adjectives
  'visíveis', 'visível', 'confiável', 'necessária',
  'inteira', 'inteiro',
  // PT typo cascades
  'recomiendado', 'Gravandel', 'guardadar', 'agrupacións',
  // PT specific verbs/words missed
  'transcreve', 'gravador', 'fundir', 'esconder',
  'mensagem', 'abaixo', 'fluxo',
  'envio ', 'Envio ', // PT (no accent)
  'compartilhad',
  'Ouvindo', 'ouvindo',
]

// SAFE substrings (ES words that contain PT-like fragments)
const SAFE_FALSE_POSITIVES = [
  'intentar', 'Intentar',
  'consolidado', 'consolidada', 'consolidados', 'consolidadas',
  'organizado', 'organizada', 'organizados', 'organizadas',
  'continuar', 'continúa', 'continua',
  'escucha', 'escuchar', 'Escuchando',
  'envío', 'Envío',
  'contenido', 'contigo', 'conmigo',
  'recomendado', 'recomendada',
]

function hasPtResidual(value) {
  if (typeof value !== 'string') return null
  let v = value
  for (const safe of SAFE_FALSE_POSITIVES) v = v.split(safe).join('___SAFE___')
  for (const token of PT_RESIDUAL_TOKENS) {
    if (token instanceof RegExp) {
      if (token.test(v)) return token.source
    } else {
      if (v.includes(token)) return token.trim()
    }
  }
  return null
}

for (const name of nonPtLocales) {
  const hits = []
  for (const key of ptKeys) {
    const val = data[name][key]
    if (val === undefined) continue
    // Strip leading `'` and trailing `'` if it's a string literal
    let strVal = val
    if (strVal.startsWith("'") && strVal.endsWith("'")) {
      strVal = strVal.slice(1, -1)
    }
    // Strip backtick template if simple
    const hit = hasPtResidual(strVal)
    if (hit) hits.push({ key, value: strVal.slice(0, 140), token: hit })
  }
  if (hits.length) {
    issues.push({
      kind: 'pt-residual',
      locale: name,
      count: hits.length,
      sample: hits.slice(0, 8),
      message: `Locale ${name}: ${hits.length} valor${hits.length === 1 ? '' : 'es'} com palavra(s) PT (heurística).`,
    })
  }
}

// ─── Report ────────────────────────────────────────────────────────
const summary = {
  source: path.relative(projectRoot, sourcePath),
  locales: LOCALES.map(name => ({
    name,
    keyCount: Object.keys(data[name]).filter(k => k !== '__spread__').length,
    hasSpread: !!data[name].__spread__,
  })),
  issuesCount: issues.length,
  issues,
}

console.log(JSON.stringify(summary, null, 2))

// Categoria de issues:
// - FAIL: structural (faz o build colapsar) — missing-keys, extra-keys, spread-fallback, pt-residual.
// - WARN: identical-to-pt (PT e ES compartilham muito vocabulário; revisão manual decide).
const FAIL_KINDS = new Set(['missing-keys', 'extra-keys', 'spread-fallback', 'pt-residual'])
const failures = issues.filter(i => FAIL_KINDS.has(i.kind))
const warnings = issues.filter(i => !FAIL_KINDS.has(i.kind))

if (warnings.length) {
  console.error(`\n[audit-i18n] WARN: ${warnings.length} issue(s) leve(s) (não bloqueante).`)
}
if (failures.length > 0) {
  console.error(`\n[audit-i18n] FAIL: ${failures.length} problema(s) estrutural(is).`)
  process.exit(1)
}

console.log('\n[audit-i18n] OK: paridade total, sem spread, sem resíduo PT detectado.')
