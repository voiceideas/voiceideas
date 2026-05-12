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

// VI_RELEASE.ANDROID.1.icon-fix (2026-05-12):
//   Adaptive icons em Android 8+ aplicam máscara do sistema (squircle/circle)
//   E zoom de 1.5x sobre a região de segurança (66% central) do foreground.
//   Antes, o foreground era apenas a icon-512.png redimensionada — então a
//   máscara cortava as bordas E o conteúdo aparecia "zoom in" sem espaço.
//   Aqui geramos o foreground com a icon centralizada dentro de uma "safe
//   area" (~66% do canvas) com bordas transparentes, atendendo o spec
//   Material Design de adaptive icons.
//
//   Estratégia: usa ffmpeg para escalar a icon e adicionar pad transparente
//   nas bordas. Fallback para sips (sem padding) se ffmpeg não estiver no
//   PATH — preserva o comportamento original em ambientes sem ffmpeg.
async function ffmpegAvailable() {
  try {
    await execFile('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

// `safeAreaRatio` é a fração do canvas que a icon ocupa. 0.66 ≈ recomendação
// Material Design para foreground de adaptive icons (66% central seguros).
async function resizePngWithSafeArea(sourcePath, canvasSize, targetPath, safeAreaRatio = 0.66) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  // Tamanho do conteúdo centralizado. Inteiro pra ffmpeg não reclamar.
  const inner = Math.max(1, Math.round(canvasSize * safeAreaRatio))
  const pad = Math.round((canvasSize - inner) / 2)
  // ffmpeg scale + pad com cor transparente (0x00000000).
  await execFile('ffmpeg', [
    '-y',
    '-i', sourcePath,
    '-vf', `scale=${inner}:${inner}:flags=lanczos,pad=${canvasSize}:${canvasSize}:${pad}:${pad}:color=0x00000000`,
    '-frames:v', '1',
    targetPath,
  ])
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

  // Legacy icon: usado em Android <= 7 e como fallback. Sem safe-area;
  // a icon já tem bordas estilizadas (rounded-square + gradient).
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

  // Foreground adaptativo: precisa de safe-area (~66%) com fundo transparente
  // para o sistema compor com a background color sem cortar/zoom-clip.
  const hasFfmpeg = await ffmpegAvailable()
  if (!hasFfmpeg) {
    console.warn('[sync-mobile-icons] ffmpeg não encontrado — adaptive icon será gerado sem safe-area (fallback). Instale ffmpeg para resultado ideal.')
  }

  for (const [densityDir, size] of androidForegroundIconSizes) {
    const targetPath = path.join(targetDir, densityDir, 'ic_launcher_foreground.png')
    if (hasFfmpeg) {
      await resizePngWithSafeArea(sourceCanonicalIcon, size, targetPath, 0.66)
    } else {
      await resizePng(sourceCanonicalIcon, size, targetPath)
    }
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
