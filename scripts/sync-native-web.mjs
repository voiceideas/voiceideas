import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const webDistDir = path.join(projectRoot, 'dist')
const nativeWebDir = path.join(projectRoot, 'desktop-dist')

const excludedNames = new Set([
  'VoiceIdeas.app',
])

function shouldSkipEntry(name) {
  return excludedNames.has(name) || name.endsWith('.dmg')
}

async function main() {
  const entries = await readdir(webDistDir, { withFileTypes: true })

  await rm(nativeWebDir, { recursive: true, force: true })
  await mkdir(nativeWebDir, { recursive: true })

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) {
      continue
    }

    const sourcePath = path.join(webDistDir, entry.name)
    const targetPath = path.join(nativeWebDir, entry.name)
    await cp(sourcePath, targetPath, { recursive: true })
  }
}

main().catch((error) => {
  console.error('Falha ao sincronizar bundle web para shells nativos.', error)
  process.exitCode = 1
})
