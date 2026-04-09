import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const sourceIosDir = path.join(projectRoot, 'src-tauri', 'icons', 'ios')
const targetIosDir = path.join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
const sourceAndroidDir = path.join(projectRoot, 'src-tauri', 'icons', 'android')
const targetAndroidResDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res')

const iosIconFiles = [
  'AppIcon-20x20@1x.png',
  'AppIcon-20x20@2x-1.png',
  'AppIcon-20x20@2x.png',
  'AppIcon-20x20@3x.png',
  'AppIcon-29x29@1x.png',
  'AppIcon-29x29@2x-1.png',
  'AppIcon-29x29@2x.png',
  'AppIcon-29x29@3x.png',
  'AppIcon-40x40@1x.png',
  'AppIcon-40x40@2x-1.png',
  'AppIcon-40x40@2x.png',
  'AppIcon-40x40@3x.png',
  'AppIcon-60x60@2x.png',
  'AppIcon-60x60@3x.png',
  'AppIcon-76x76@1x.png',
  'AppIcon-76x76@2x.png',
  'AppIcon-83.5x83.5@2x.png',
  'AppIcon-512@2x.png',
]

const androidIconFiles = [
  'mipmap-anydpi-v26/ic_launcher.xml',
  'mipmap-hdpi/ic_launcher.png',
  'mipmap-hdpi/ic_launcher_foreground.png',
  'mipmap-hdpi/ic_launcher_round.png',
  'mipmap-mdpi/ic_launcher.png',
  'mipmap-mdpi/ic_launcher_foreground.png',
  'mipmap-mdpi/ic_launcher_round.png',
  'mipmap-xhdpi/ic_launcher.png',
  'mipmap-xhdpi/ic_launcher_foreground.png',
  'mipmap-xhdpi/ic_launcher_round.png',
  'mipmap-xxhdpi/ic_launcher.png',
  'mipmap-xxhdpi/ic_launcher_foreground.png',
  'mipmap-xxhdpi/ic_launcher_round.png',
  'mipmap-xxxhdpi/ic_launcher.png',
  'mipmap-xxxhdpi/ic_launcher_foreground.png',
  'mipmap-xxxhdpi/ic_launcher_round.png',
  'values/ic_launcher_background.xml',
]

async function pathExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function copyFiles(sourceDir, targetDir, files) {
  for (const relativePath of files) {
    const sourcePath = path.join(sourceDir, relativePath)
    if (!(await pathExists(sourcePath))) {
      throw new Error(`App icon source not found at ${sourcePath}`)
    }

    const targetPath = path.join(targetDir, relativePath)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await cp(sourcePath, targetPath, { force: true })
  }
}

async function main() {
  await copyFiles(sourceIosDir, targetIosDir, iosIconFiles)
  await copyFiles(sourceAndroidDir, targetAndroidResDir, androidIconFiles)
}

main().catch((error) => {
  console.error('Falha ao sincronizar o ícone mobile.', error)
  process.exitCode = 1
})
