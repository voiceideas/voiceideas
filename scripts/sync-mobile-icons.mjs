import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const sourceIosDir = path.join(projectRoot, 'src-tauri', 'icons', 'ios')
const targetIosDir = path.join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
const targetAndroidResDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res')
const generatedAndroidIconDir = path.join(projectRoot, 'src-tauri', 'icons', 'android')
const sourceCanonicalIcon = path.join(projectRoot, 'public', 'icons', 'icon-512.png')
const execFile = promisify(execFileCallback)

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

const androidLegacyIconSizes = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
]

const androidForegroundIconSizes = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
]

const adaptiveLauncherXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
`

const androidLauncherBackgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#000000</color>
</resources>
`

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

async function resizePng(sourcePath, size, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await execFile('sips', ['-z', String(size), String(size), sourcePath, '--out', targetPath])
}

async function writeAndroidAdaptiveFiles(targetDir) {
  const iconXmlPath = path.join(targetDir, 'mipmap-anydpi-v26', 'ic_launcher.xml')
  const iconRoundXmlPath = path.join(targetDir, 'mipmap-anydpi-v26', 'ic_launcher_round.xml')
  const backgroundXmlPath = path.join(targetDir, 'values', 'ic_launcher_background.xml')

  await mkdir(path.dirname(iconXmlPath), { recursive: true })
  await mkdir(path.dirname(backgroundXmlPath), { recursive: true })

  await writeFile(iconXmlPath, adaptiveLauncherXml)
  await writeFile(iconRoundXmlPath, adaptiveLauncherXml)
  await writeFile(backgroundXmlPath, androidLauncherBackgroundXml)
}

async function generateAndroidIcons(targetDir) {
  if (!(await pathExists(sourceCanonicalIcon))) {
    throw new Error(`App icon source not found at ${sourceCanonicalIcon}`)
  }

  for (const [densityDir, size] of androidLegacyIconSizes) {
    await resizePng(
      sourceCanonicalIcon,
      size,
      path.join(targetDir, densityDir, 'ic_launcher.png'),
    )
    await resizePng(
      sourceCanonicalIcon,
      size,
      path.join(targetDir, densityDir, 'ic_launcher_round.png'),
    )
  }

  for (const [densityDir, size] of androidForegroundIconSizes) {
    await resizePng(
      sourceCanonicalIcon,
      size,
      path.join(targetDir, densityDir, 'ic_launcher_foreground.png'),
    )
  }

  await writeAndroidAdaptiveFiles(targetDir)
}

async function main() {
  await copyFiles(sourceIosDir, targetIosDir, iosIconFiles)
  await generateAndroidIcons(generatedAndroidIconDir)
  await generateAndroidIcons(targetAndroidResDir)
}

main().catch((error) => {
  console.error('Falha ao sincronizar o ícone mobile.', error)
  process.exitCode = 1
})
