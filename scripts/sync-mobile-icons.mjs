import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const sourceAppIcon = path.join(projectRoot, 'src-tauri', 'icons', 'ios', 'AppIcon-512@2x.png')
const targetDir = path.join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
const targetAppIcon = path.join(targetDir, 'AppIcon-512@2x.png')

async function pathExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await pathExists(sourceAppIcon))) {
    throw new Error(`App icon source not found at ${sourceAppIcon}`)
  }

  await mkdir(targetDir, { recursive: true })
  await cp(sourceAppIcon, targetAppIcon)
}

main().catch((error) => {
  console.error('Falha ao sincronizar o ícone mobile.', error)
  process.exitCode = 1
})
