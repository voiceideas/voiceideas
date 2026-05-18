#!/usr/bin/env node
/**
 * VI_VERSION_BUMP_AUTOMATION (2026-05-18)
 *
 * Sincroniza versão entre os 5 arquivos críticos do VoiceIdeas em
 * uma operação atômica. Substitui o procedimento manual em 4 passos
 * documentado em `docs/RELEASE_VERSIONING.md`.
 *
 * Uso:
 *   node scripts/bump-version.mjs 0.2.0        # versão explícita
 *   node scripts/bump-version.mjs --patch      # 0.1.0 → 0.1.1
 *   node scripts/bump-version.mjs --minor      # 0.1.0 → 0.2.0
 *   node scripts/bump-version.mjs --major      # 0.1.0 → 1.0.0
 *
 * Flags:
 *   --android-version-code N  override do versionCode (default: atual+1)
 *   --commit                  cria commit chore(release): bump X→Y
 *   --chronicle               apende stub em VOICEIDEAS_CURRENT_STATE.md
 *   --force-downgrade         permite ir para versão menor
 *
 * Garante:
 *   1. drift check ANTES do bump (falha se arquivos divergem)
 *   2. aplica mudança nos 5 arquivos
 *   3. drift check DEPOIS do bump (sanity)
 *   4. resumo humano impresso
 *
 * NÃO faz:
 *   - git tag (manual e ordenado, conforme guardrail)
 *   - commit (a menos que --commit)
 *   - chronicle (a menos que --chronicle)
 *   - mexer em tag v0.1.0 (preservada)
 *   - gerar artefatos de build (DMG/APK/IPA)
 *
 * Spec: ordem `VI_VERSION_BUMP_AUTOMATION` (Gian, 2026-05-18).
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(__filename)
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..')

// ─── Semver ──────────────────────────────────────────────────────────

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/

export function parseSemver(value) {
  const match = SEMVER_REGEX.exec(String(value).trim())
  if (!match) throw new Error(`Invalid semver: "${value}"`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`
}

export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

export function bumpSemver(current, kind) {
  const parts = parseSemver(current)
  if (kind === 'patch') return formatSemver({ ...parts, patch: parts.patch + 1 })
  if (kind === 'minor') {
    return formatSemver({ major: parts.major, minor: parts.minor + 1, patch: 0 })
  }
  if (kind === 'major') {
    return formatSemver({ major: parts.major + 1, minor: 0, patch: 0 })
  }
  throw new Error(`Unknown bump kind: ${kind}`)
}

// ─── File registry ───────────────────────────────────────────────────

/**
 * Cada entrada descreve como ler/escrever a versão de um arquivo.
 * O readers/writers retornam/aceitam apenas a versão semver (string).
 * Campos auxiliares (versionCode, currentProjectVersion) são tratados
 * separadamente em `readSecondaryValues` / `writeSecondaryValues`.
 */
function readJsonField(filePath, fieldPath) {
  const text = readFileSync(filePath, 'utf-8')
  const json = JSON.parse(text)
  let cursor = json
  for (const key of fieldPath) {
    cursor = cursor?.[key]
  }
  return cursor
}

function writeJsonField(filePath, fieldPath, value) {
  const text = readFileSync(filePath, 'utf-8')
  const json = JSON.parse(text)
  let cursor = json
  for (let i = 0; i < fieldPath.length - 1; i++) {
    cursor = cursor[fieldPath[i]]
  }
  cursor[fieldPath[fieldPath.length - 1]] = value
  writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf-8')
}

function readRegexCapture(filePath, regex) {
  const text = readFileSync(filePath, 'utf-8')
  const match = regex.exec(text)
  if (!match) throw new Error(`Pattern ${regex} not found in ${filePath}`)
  return match[1]
}

function writeRegexReplace(filePath, regex, replacement) {
  const text = readFileSync(filePath, 'utf-8')
  const updated = text.replace(regex, replacement)
  if (updated === text) {
    throw new Error(`Replace failed (no match) for ${regex} in ${filePath}`)
  }
  writeFileSync(filePath, updated, 'utf-8')
}

/**
 * Coleta TODAS as ocorrências de uma regex e valida unicidade.
 * Retorna o valor único, ou lança se houver drift interno.
 */
function readAllOccurrencesUnique(filePath, regex, label) {
  const text = readFileSync(filePath, 'utf-8')
  const occurrences = [...text.matchAll(regex)].map((m) => m[1])
  if (occurrences.length === 0) {
    throw new Error(`No occurrences of ${label} found in ${filePath}`)
  }
  const unique = new Set(occurrences)
  if (unique.size !== 1) {
    throw new Error(
      `Internal drift in ${filePath} (${label}): ${[...unique].join(' vs ')}`,
    )
  }
  return [...unique][0]
}

function writeAllOccurrencesReplace(filePath, regex, replacement) {
  const text = readFileSync(filePath, 'utf-8')
  const updated = text.replace(regex, replacement)
  if (updated === text) {
    throw new Error(`Replace failed (no match) for ${regex} in ${filePath}`)
  }
  writeFileSync(filePath, updated, 'utf-8')
}

// ─── Versions readers (primary semver) ───────────────────────────────

export function readVersionsFromFiles(rootDir = DEFAULT_ROOT) {
  const versions = {}

  // 1. package.json
  versions['package.json'] = readJsonField(
    resolve(rootDir, 'package.json'),
    ['version'],
  )

  // 2. package-lock.json (top-level + packages[""])
  const lockPath = resolve(rootDir, 'package-lock.json')
  if (existsSync(lockPath)) {
    versions['package-lock.json.root'] = readJsonField(lockPath, ['version'])
    versions['package-lock.json.packages'] = readJsonField(lockPath, [
      'packages',
      '',
      'version',
    ])
  }

  // 3. src-tauri/tauri.conf.json
  versions['tauri.conf.json'] = readJsonField(
    resolve(rootDir, 'src-tauri/tauri.conf.json'),
    ['version'],
  )

  // 4. src-tauri/Cargo.toml — `version = "X.Y.Z"` na seção [package]
  versions['Cargo.toml'] = readRegexCapture(
    resolve(rootDir, 'src-tauri/Cargo.toml'),
    /^version\s*=\s*"([^"]+)"/m,
  )

  // 5. android/app/build.gradle — `versionName "X.Y.Z"`
  versions['build.gradle.versionName'] = readRegexCapture(
    resolve(rootDir, 'android/app/build.gradle'),
    /versionName\s+"([^"]+)"/,
  )

  // 6. ios pbxproj — MARKETING_VERSION (todas as ocorrências devem ser iguais)
  versions['pbxproj.MARKETING_VERSION'] = readAllOccurrencesUnique(
    resolve(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'),
    /MARKETING_VERSION = ([^;]+);/g,
    'MARKETING_VERSION',
  )

  return versions
}

export function readSecondaryValues(rootDir = DEFAULT_ROOT) {
  return {
    'build.gradle.versionCode': Number(
      readRegexCapture(
        resolve(rootDir, 'android/app/build.gradle'),
        /versionCode\s+(\d+)/,
      ),
    ),
    'pbxproj.CURRENT_PROJECT_VERSION': Number(
      readAllOccurrencesUnique(
        resolve(rootDir, 'ios/App/App.xcodeproj/project.pbxproj'),
        /CURRENT_PROJECT_VERSION = (\d+);/g,
        'CURRENT_PROJECT_VERSION',
      ),
    ),
  }
}

// ─── Drift detection ─────────────────────────────────────────────────

export function detectDrift(versions) {
  const values = Object.values(versions)
  const unique = new Set(values)
  if (unique.size === 1) return null
  const grouped = {}
  for (const [key, value] of Object.entries(versions)) {
    if (!grouped[value]) grouped[value] = []
    grouped[value].push(key)
  }
  const lines = Object.entries(grouped)
    .map(([value, files]) => `  • ${value}: ${files.join(', ')}`)
    .join('\n')
  return `Version drift detected across files:\n${lines}\n\nFix manually before bumping (edit each file to the same version) OR use --force-downgrade if you know what you're doing.`
}

// ─── Apply bump ──────────────────────────────────────────────────────

export function applyBumpToFiles(rootDir, newVersion, options = {}) {
  const { androidVersionCodeOverride = null } = options
  const changed = []
  const oldSecondary = readSecondaryValues(rootDir)
  const newAndroidVersionCode =
    androidVersionCodeOverride !== null
      ? androidVersionCodeOverride
      : oldSecondary['build.gradle.versionCode'] + 1
  const newCurrentProjectVersion =
    oldSecondary['pbxproj.CURRENT_PROJECT_VERSION'] + 1

  // 1. package.json
  const pkgPath = resolve(rootDir, 'package.json')
  writeJsonField(pkgPath, ['version'], newVersion)
  changed.push('package.json')

  // 2. package-lock.json (se existir)
  const lockPath = resolve(rootDir, 'package-lock.json')
  if (existsSync(lockPath)) {
    writeJsonField(lockPath, ['version'], newVersion)
    writeJsonField(lockPath, ['packages', '', 'version'], newVersion)
    changed.push('package-lock.json')
  }

  // 3. tauri.conf.json
  writeJsonField(
    resolve(rootDir, 'src-tauri/tauri.conf.json'),
    ['version'],
    newVersion,
  )
  changed.push('src-tauri/tauri.conf.json')

  // 4. Cargo.toml
  writeRegexReplace(
    resolve(rootDir, 'src-tauri/Cargo.toml'),
    /^version\s*=\s*"[^"]+"/m,
    `version = "${newVersion}"`,
  )
  changed.push('src-tauri/Cargo.toml')

  // 5. android/app/build.gradle — versionName + versionCode
  const gradlePath = resolve(rootDir, 'android/app/build.gradle')
  writeRegexReplace(
    gradlePath,
    /versionName\s+"[^"]+"/,
    `versionName "${newVersion}"`,
  )
  writeRegexReplace(
    gradlePath,
    /versionCode\s+\d+/,
    `versionCode ${newAndroidVersionCode}`,
  )
  changed.push('android/app/build.gradle')

  // 6. ios pbxproj — MARKETING_VERSION + CURRENT_PROJECT_VERSION
  const pbxprojPath = resolve(rootDir, 'ios/App/App.xcodeproj/project.pbxproj')
  writeAllOccurrencesReplace(
    pbxprojPath,
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${newVersion};`,
  )
  writeAllOccurrencesReplace(
    pbxprojPath,
    /CURRENT_PROJECT_VERSION = \d+;/g,
    `CURRENT_PROJECT_VERSION = ${newCurrentProjectVersion};`,
  )
  changed.push('ios/App/App.xcodeproj/project.pbxproj')

  return {
    changedFiles: changed,
    oldVersionCode: oldSecondary['build.gradle.versionCode'],
    newVersionCode: newAndroidVersionCode,
    oldCurrentProjectVersion: oldSecondary['pbxproj.CURRENT_PROJECT_VERSION'],
    newCurrentProjectVersion,
  }
}

// ─── CLI helpers ─────────────────────────────────────────────────────

export function parseCliArgs(argv) {
  const args = {
    targetVersion: null,
    kind: null,
    androidVersionCode: null,
    commit: false,
    chronicle: false,
    forceDowngrade: false,
    rootDir: DEFAULT_ROOT,
    helpRequested: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--patch') args.kind = 'patch'
    else if (arg === '--minor') args.kind = 'minor'
    else if (arg === '--major') args.kind = 'major'
    else if (arg === '--commit') args.commit = true
    else if (arg === '--chronicle') args.chronicle = true
    else if (arg === '--force-downgrade') args.forceDowngrade = true
    else if (arg === '--android-version-code') {
      args.androidVersionCode = Number(argv[++i])
      if (!Number.isInteger(args.androidVersionCode) || args.androidVersionCode < 1) {
        throw new Error('--android-version-code must be a positive integer')
      }
    } else if (arg === '--cwd') {
      args.rootDir = resolve(process.cwd(), argv[++i])
    } else if (arg === '--help' || arg === '-h') {
      args.helpRequested = true
    } else if (!arg.startsWith('--') && !args.targetVersion) {
      args.targetVersion = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (args.kind && args.targetVersion) {
    throw new Error('Cannot combine explicit version with --patch/--minor/--major')
  }
  if (!args.kind && !args.targetVersion && !args.helpRequested) {
    throw new Error(
      'Must provide either explicit version (e.g. 0.2.0) or --patch/--minor/--major',
    )
  }
  return args
}

function printUsage() {
  console.log(`
VoiceIdeas version bump — sincroniza versão em 5 arquivos.

Uso:
  npm run version:bump 0.2.0
  npm run version:bump -- --patch
  npm run version:bump -- --minor --commit
  npm run version:bump -- --major --commit --chronicle

Flags:
  --patch | --minor | --major   bump semver a partir da versão atual
  --android-version-code N      override do versionCode (default: atual+1)
  --commit                      cria commit chore(release): bump X→Y
  --chronicle                   apende stub em VOICEIDEAS_CURRENT_STATE.md
  --force-downgrade             permite ir para versão menor
  --cwd <path>                  diretório raiz (default: cwd do script)

Garantias:
  - drift check ANTES do bump (falha se arquivos divergem)
  - re-validação DEPOIS do bump
  - resumo humano impresso
  - NUNCA cria git tag
  - NUNCA usa 'git add -A' (lista arquivos explicitamente)
`)
}

function printSummary(input) {
  const {
    oldVersion,
    newVersion,
    oldVersionCode,
    newVersionCode,
    oldCurrentProjectVersion,
    newCurrentProjectVersion,
    changedFiles,
  } = input
  console.log('\n─── Bump summary ───────────────────────────────────────\n')
  console.log(`  Version:                       ${oldVersion} → ${newVersion}`)
  console.log(`  Android versionCode:           ${oldVersionCode} → ${newVersionCode}`)
  console.log(`  iOS CURRENT_PROJECT_VERSION:   ${oldCurrentProjectVersion} → ${newCurrentProjectVersion}`)
  console.log('\n  Files updated:')
  for (const f of changedFiles) console.log(`    • ${f}`)
  console.log('')
}

function runGitCommit(rootDir, oldVersion, newVersion, changedFiles) {
  const args = ['add', '--', ...changedFiles]
  execSync(`git ${args.join(' ')}`, { cwd: rootDir, stdio: 'inherit' })
  const msg = `chore(release): bump ${oldVersion} → ${newVersion}\n\nVI_VERSION_BUMP_AUTOMATION — sincronização automática via\nscripts/bump-version.mjs. Validado pelo drift check antes e depois.`
  execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

function appendChronicleStub(rootDir, oldVersion, newVersion) {
  const chroniclePath = resolve(rootDir, 'VOICEIDEAS_CURRENT_STATE.md')
  if (!existsSync(chroniclePath)) return false
  const text = readFileSync(chroniclePath, 'utf-8')
  const anchor = '## 4)' // simples — apende antes do primeiro `## 4)` se existir
  // Stub minimal — deve ser editado manualmente para descrever a release
  const today = new Date().toISOString().slice(0, 10)
  const stub = `\n### 4.XX) RELEASE_BUMP — ${oldVersion} → ${newVersion} (${today})\n\n**Status:** ⏳ STUB — preencha manualmente após o bump real.\n\n**O que entrou nesta versão:**\n* TODO: listar features/fixes consolidados.\n\n**Validações pendentes pós-bump:**\n* tsc / build / smokes / desktop:build / cap sync ios / android:build:apk\n\n---\n`
  const updated = text.includes(anchor)
    ? text.replace(anchor, stub + anchor)
    : text + stub
  writeFileSync(chroniclePath, updated, 'utf-8')
  return true
}

// ─── Main ────────────────────────────────────────────────────────────

export function main(argv) {
  const args = parseCliArgs(argv)

  if (args.helpRequested) {
    printUsage()
    return 0
  }

  const versions = readVersionsFromFiles(args.rootDir)

  // Drift check pré-bump
  const drift = detectDrift(versions)
  if (drift) {
    console.error('\n[bump-version] ERROR — pre-bump drift check failed:\n')
    console.error(drift)
    return 1
  }

  const oldVersion = versions['package.json']
  const newVersion = args.targetVersion ?? bumpSemver(oldVersion, args.kind)

  // Sanity semver
  parseSemver(newVersion)

  // Downgrade check
  if (compareSemver(newVersion, oldVersion) < 0 && !args.forceDowngrade) {
    console.error(
      `\n[bump-version] ERROR — refusing to downgrade from ${oldVersion} to ${newVersion} (use --force-downgrade to override).`,
    )
    return 1
  }
  if (compareSemver(newVersion, oldVersion) === 0) {
    console.error(
      `\n[bump-version] ERROR — target version equals current (${oldVersion}). Nothing to do.`,
    )
    return 1
  }

  // Apply
  const result = applyBumpToFiles(args.rootDir, newVersion, {
    androidVersionCodeOverride: args.androidVersionCode,
  })

  // Drift check pós-bump (sanity)
  const postVersions = readVersionsFromFiles(args.rootDir)
  const postDrift = detectDrift(postVersions)
  if (postDrift) {
    console.error(
      '\n[bump-version] FATAL — post-bump drift detected. Files in inconsistent state:',
    )
    console.error(postDrift)
    return 2
  }

  printSummary({
    oldVersion,
    newVersion,
    oldVersionCode: result.oldVersionCode,
    newVersionCode: result.newVersionCode,
    oldCurrentProjectVersion: result.oldCurrentProjectVersion,
    newCurrentProjectVersion: result.newCurrentProjectVersion,
    changedFiles: result.changedFiles,
  })

  if (args.chronicle) {
    const ok = appendChronicleStub(args.rootDir, oldVersion, newVersion)
    if (ok) console.log('[bump-version] Chronicle stub appended.')
  }

  if (args.commit) {
    try {
      runGitCommit(args.rootDir, oldVersion, newVersion, result.changedFiles)
      console.log('[bump-version] Commit created.')
    } catch (err) {
      console.error(`[bump-version] Commit failed: ${err.message}`)
      return 3
    }
  } else {
    console.log(
      '[bump-version] Files modified but NOT committed. Use --commit to commit automatically, or `git status` to review.',
    )
  }

  return 0
}

// Direct CLI invocation guard
const isDirectInvocation = process.argv[1] === __filename
if (isDirectInvocation) {
  try {
    const code = main(process.argv.slice(2))
    process.exit(code)
  } catch (err) {
    console.error(`[bump-version] ${err.message}`)
    process.exit(1)
  }
}
