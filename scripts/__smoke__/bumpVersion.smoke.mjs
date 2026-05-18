#!/usr/bin/env node
/**
 * VI_VERSION_BUMP_AUTOMATION (2026-05-18)
 *
 * Smoke unit do `bump-version.mjs`. Cria fixtures temporários em
 * `os.tmpdir()`, roda funções puras do script contra o tmpdir, valida
 * resultado.
 *
 * Cenários (10):
 *   1. parseSemver / formatSemver / compareSemver
 *   2. bumpSemver patch / minor / major
 *   3. Bump explícito versão alvo (0.2.0)
 *   4. Bump --minor incrementa corretamente
 *   5. Bump --major reseta minor/patch
 *   6. detectDrift retorna null quando tudo bate
 *   7. detectDrift retorna mensagem quando algum arquivo diverge
 *   8. Rejeita downgrade sem --force-downgrade
 *   9. versionCode incrementa +1 por default
 *  10. versionCode override via --android-version-code
 *  11. CURRENT_PROJECT_VERSION incrementa +1
 *  12. NÃO cria git tag (verifica via comportamento — applyBumpToFiles
 *      não toca em .git)
 *
 * Executar: npm run smoke:version-bump
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  applyBumpToFiles,
  bumpSemver,
  compareSemver,
  detectDrift,
  formatSemver,
  main,
  parseCliArgs,
  parseSemver,
  readSecondaryValues,
  readVersionsFromFiles,
} from '../bump-version.mjs'

// ─── Fixture builder ─────────────────────────────────────────────────

function createFixtureRoot(version, versionCode, currentProjectVersion) {
  const root = mkdtempSync(join(tmpdir(), 'vi-bump-fixture-'))

  // package.json
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'voice-ideas', version, scripts: {} }, null, 2) + '\n',
  )

  // package-lock.json (top-level + packages[""])
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'voice-ideas',
        version,
        lockfileVersion: 3,
        packages: {
          '': { name: 'voice-ideas', version },
          'node_modules/some-dep': { version: '7.29.0' },
        },
      },
      null,
      2,
    ) + '\n',
  )

  // src-tauri/tauri.conf.json
  mkdirSync(join(root, 'src-tauri'), { recursive: true })
  writeFileSync(
    join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ productName: 'VoiceIdeas', version }, null, 2) + '\n',
  )

  // src-tauri/Cargo.toml
  writeFileSync(
    join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "voiceideas"\nversion = "${version}"\ndescription = "VoiceIdeas desktop app"\n`,
  )

  // android/app/build.gradle
  mkdirSync(join(root, 'android/app'), { recursive: true })
  writeFileSync(
    join(root, 'android/app/build.gradle'),
    `android {\n    defaultConfig {\n        applicationId "com.voiceideas.mobile"\n        versionCode ${versionCode}\n        versionName "${version}"\n    }\n}\n`,
  )

  // ios/App/App.xcodeproj/project.pbxproj
  mkdirSync(join(root, 'ios/App/App.xcodeproj'), { recursive: true })
  writeFileSync(
    join(root, 'ios/App/App.xcodeproj/project.pbxproj'),
    `// Debug config\n\t\t\t\tCURRENT_PROJECT_VERSION = ${currentProjectVersion};\n\t\t\t\tMARKETING_VERSION = ${version};\n// Release config\n\t\t\t\tCURRENT_PROJECT_VERSION = ${currentProjectVersion};\n\t\t\t\tMARKETING_VERSION = ${version};\n`,
  )

  return root
}

function cleanupFixture(root) {
  rmSync(root, { recursive: true, force: true })
}

// ─── Test harness ────────────────────────────────────────────────────

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`[PASS] ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.error(`[FAIL] ${name}`)
    console.error(`        ${err.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// ─── Cenários ────────────────────────────────────────────────────────

console.log('=== bump-version smoke (VI_VERSION_BUMP_AUTOMATION) ===\n')

test('S1: parseSemver / formatSemver / compareSemver', () => {
  const parsed = parseSemver('0.1.0')
  assert(parsed.major === 0 && parsed.minor === 1 && parsed.patch === 0, 'parse 0.1.0')
  assert(formatSemver({ major: 1, minor: 2, patch: 3 }) === '1.2.3', 'format')
  assert(compareSemver('0.1.0', '0.2.0') === -1, '0.1.0 < 0.2.0')
  assert(compareSemver('0.2.0', '0.1.0') === 1, '0.2.0 > 0.1.0')
  assert(compareSemver('1.0.0', '1.0.0') === 0, 'equal')
  let threw = false
  try {
    parseSemver('not-semver')
  } catch {
    threw = true
  }
  assert(threw, 'rejects invalid semver')
})

test('S2: bumpSemver patch / minor / major', () => {
  assert(bumpSemver('0.1.0', 'patch') === '0.1.1', 'patch')
  assert(bumpSemver('0.1.0', 'minor') === '0.2.0', 'minor resets patch')
  assert(bumpSemver('0.1.5', 'minor') === '0.2.0', 'minor 0.1.5 → 0.2.0')
  assert(bumpSemver('0.1.0', 'major') === '1.0.0', 'major resets minor+patch')
  assert(bumpSemver('1.2.3', 'major') === '2.0.0', 'major 1.2.3 → 2.0.0')
})

test('S3: Bump explícito 0.1.0 → 0.2.0 sincroniza 5 arquivos', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    const result = applyBumpToFiles(root, '0.2.0')
    assert(result.changedFiles.length === 6, `6 arquivos alterados (got ${result.changedFiles.length})`)
    const post = readVersionsFromFiles(root)
    for (const [key, value] of Object.entries(post)) {
      assert(value === '0.2.0', `${key} = ${value} (expected 0.2.0)`)
    }
  } finally {
    cleanupFixture(root)
  }
})

test('S4: Bump --minor incrementa de 0.1.0 → 0.2.0 via CLI parser + main', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    const code = main(['--minor', '--cwd', root])
    assert(code === 0, `main exit code = ${code}`)
    const post = readVersionsFromFiles(root)
    assert(post['package.json'] === '0.2.0', `package.json = ${post['package.json']}`)
    assert(post['Cargo.toml'] === '0.2.0', `Cargo = ${post['Cargo.toml']}`)
  } finally {
    cleanupFixture(root)
  }
})

test('S5: Bump --major reseta minor + patch', () => {
  const root = createFixtureRoot('0.1.5', 2, 2)
  try {
    const code = main(['--major', '--cwd', root])
    assert(code === 0, `main exit = ${code}`)
    const post = readVersionsFromFiles(root)
    assert(post['package.json'] === '1.0.0', `expected 1.0.0 got ${post['package.json']}`)
  } finally {
    cleanupFixture(root)
  }
})

test('S6: detectDrift retorna null quando tudo bate', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    const versions = readVersionsFromFiles(root)
    assert(detectDrift(versions) === null, 'should be null')
  } finally {
    cleanupFixture(root)
  }
})

test('S7: detectDrift retorna mensagem quando algum arquivo diverge', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    // corrupte intentionally
    writeFileSync(
      join(root, 'src-tauri/Cargo.toml'),
      `[package]\nname = "voiceideas"\nversion = "9.9.9"\n`,
    )
    const versions = readVersionsFromFiles(root)
    const drift = detectDrift(versions)
    assert(drift !== null, 'should detect drift')
    assert(drift.includes('9.9.9'), 'mentions 9.9.9')
    assert(drift.includes('Cargo.toml'), 'mentions Cargo.toml')
    // E o main() deve falhar com exit code 1
    const code = main(['0.2.0', '--cwd', root])
    assert(code === 1, `main should refuse with drift (got ${code})`)
  } finally {
    cleanupFixture(root)
  }
})

test('S8: Rejeita downgrade sem --force-downgrade', () => {
  const root = createFixtureRoot('0.5.0', 2, 2)
  try {
    const code = main(['0.1.0', '--cwd', root])
    assert(code === 1, `should refuse downgrade (got ${code})`)
    // Confirma que NÃO mudou arquivos
    const post = readVersionsFromFiles(root)
    assert(post['package.json'] === '0.5.0', 'package.json unchanged')

    // E com --force-downgrade aceita
    const code2 = main(['0.1.0', '--cwd', root, '--force-downgrade'])
    assert(code2 === 0, `should accept with --force-downgrade (got ${code2})`)
    const post2 = readVersionsFromFiles(root)
    assert(post2['package.json'] === '0.1.0', 'package.json downgraded')
  } finally {
    cleanupFixture(root)
  }
})

test('S9: versionCode incrementa +1 por default', () => {
  const root = createFixtureRoot('0.1.0', 5, 5)
  try {
    const result = applyBumpToFiles(root, '0.2.0')
    assert(result.oldVersionCode === 5, `old = 5 (got ${result.oldVersionCode})`)
    assert(result.newVersionCode === 6, `new = 6 (got ${result.newVersionCode})`)
    const sec = readSecondaryValues(root)
    assert(sec['build.gradle.versionCode'] === 6, 'versionCode persisted')
  } finally {
    cleanupFixture(root)
  }
})

test('S10: Override de versionCode via parameter', () => {
  const root = createFixtureRoot('0.1.0', 5, 5)
  try {
    const result = applyBumpToFiles(root, '0.2.0', {
      androidVersionCodeOverride: 100,
    })
    assert(result.newVersionCode === 100, `expected 100 (got ${result.newVersionCode})`)
    const sec = readSecondaryValues(root)
    assert(sec['build.gradle.versionCode'] === 100, 'versionCode = 100')
  } finally {
    cleanupFixture(root)
  }
})

test('S11: CURRENT_PROJECT_VERSION incrementa +1 (TODAS as ocorrências)', () => {
  const root = createFixtureRoot('0.1.0', 2, 7)
  try {
    const result = applyBumpToFiles(root, '0.2.0')
    assert(result.oldCurrentProjectVersion === 7, `old = 7 (got ${result.oldCurrentProjectVersion})`)
    assert(result.newCurrentProjectVersion === 8, `new = 8 (got ${result.newCurrentProjectVersion})`)
    const pbxprojPath = join(root, 'ios/App/App.xcodeproj/project.pbxproj')
    const text = readFileSync(pbxprojPath, 'utf-8')
    const matches = [...text.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(
      (m) => Number(m[1]),
    )
    assert(matches.length === 2, '2 occurrences')
    assert(
      matches.every((v) => v === 8),
      'all occurrences = 8',
    )
  } finally {
    cleanupFixture(root)
  }
})

test('S12: NÃO cria git tag (applyBumpToFiles não toca em .git)', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    applyBumpToFiles(root, '0.2.0')
    // Verifica que nada relativo a .git foi criado
    assert(!existsSync(join(root, '.git')), '.git should NOT be created by applyBumpToFiles')
  } finally {
    cleanupFixture(root)
  }
})

test('S13: parseCliArgs aceita versão explícita ou bump kind, NÃO ambos', () => {
  const a = parseCliArgs(['0.2.0'])
  assert(a.targetVersion === '0.2.0' && a.kind === null, 'explicit version')
  const b = parseCliArgs(['--minor'])
  assert(b.kind === 'minor' && b.targetVersion === null, 'minor kind')
  let threw = false
  try {
    parseCliArgs(['0.2.0', '--minor'])
  } catch {
    threw = true
  }
  assert(threw, 'rejects combined version + kind')

  let threw2 = false
  try {
    parseCliArgs([])
  } catch {
    threw2 = true
  }
  assert(threw2, 'rejects empty args')
})

test('S14: Recusa target version igual à atual', () => {
  const root = createFixtureRoot('0.1.0', 2, 2)
  try {
    const code = main(['0.1.0', '--cwd', root])
    assert(code === 1, `should refuse equal version (got ${code})`)
  } finally {
    cleanupFixture(root)
  }
})

// ─── Summary ─────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length
const total = results.length
console.log(
  `\n=== ${passed === total ? 'ALL PASS' : 'SOME FAILED'} (${passed}/${total} cases) ===`,
)
process.exit(passed === total ? 0 : 1)
