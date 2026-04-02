import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const distributionDir = path.join(projectRoot, 'dist')
const macosBundleSource = path.join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'VoiceIdeas.app')
const dmgSourceDir = path.join(projectRoot, 'src-tauri', 'target', 'release', 'bundle', 'dmg')

async function pathExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function copyDesktopApp() {
  if (!(await pathExists(macosBundleSource))) {
    return false
  }

  const targetPath = path.join(distributionDir, 'VoiceIdeas.app')
  await rm(targetPath, { recursive: true, force: true })
  await cp(macosBundleSource, targetPath, { recursive: true })
  return true
}

async function copyDmgArtifacts() {
  if (!(await pathExists(dmgSourceDir))) {
    return []
  }

  const entries = await readdir(dmgSourceDir, { withFileTypes: true })
  const copied = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.dmg')) {
      continue
    }

    const sourcePath = path.join(dmgSourceDir, entry.name)
    const targetPath = path.join(distributionDir, entry.name)
    await rm(targetPath, { force: true })
    await cp(sourcePath, targetPath)
    copied.push(entry.name)
  }

  return copied
}

async function main() {
  await mkdir(distributionDir, { recursive: true })
  await copyDesktopApp()
  await copyDmgArtifacts()
}

main().catch((error) => {
  console.error('Falha ao sincronizar artefatos do app macOS.', error)
  process.exitCode = 1
})
