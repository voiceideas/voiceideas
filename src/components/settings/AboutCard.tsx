/**
 * VI_VERSION_VISIBILITY_STANDARD (2026-05-18)
 *
 * Card "Sobre o VoiceIdeas" exibido como última seção em Settings.
 * Funciona em todas as plataformas (web, mobile nativo, Tauri desktop).
 *
 * Conteúdo:
 *   - Versão (do `package.json` injetado em build time)
 *   - Build nativo (Capacitor App.getInfo, apenas iOS/Android)
 *   - Commit curto (git rev-parse HEAD do momento do build)
 *   - Canal (production/development/custom)
 *   - Plataforma detectada em runtime
 *
 * Fonte de verdade: `src/lib/appVersion.ts`. Nada hardcoded aqui.
 */

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import {
  formatPlatform,
  getAppVersionInfo,
  type AppVersionInfo,
} from '../../lib/appVersion'
import { useI18n } from '../../hooks/useI18n'

export function AboutCard() {
  const { t } = useI18n()
  const [info, setInfo] = useState<AppVersionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAppVersionInfo()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch(() => {
        // helper já tolera falha de native build — não bloqueia UI
      })
    return () => {
      cancelled = true
    }
  }, [])

  const unknown = t('settings.about.unknownValue')

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: t('settings.about.versionLabel'),
      value: info?.version ?? unknown,
      mono: true,
    },
    ...(info?.nativeBuild
      ? [
          {
            label: t('settings.about.buildLabel'),
            value: info.nativeBuild,
            mono: true,
          },
        ]
      : []),
    {
      label: t('settings.about.commitLabel'),
      value: info?.commit && info.commit !== 'unknown' ? info.commit : unknown,
      mono: true,
    },
    {
      label: t('settings.about.channelLabel'),
      value: info?.channel ?? unknown,
    },
    {
      label: t('settings.about.platformLabel'),
      value: info ? formatPlatform(info.platform) : unknown,
    },
  ]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
          <Info className="h-5 w-5 text-slate-700" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">
            {t('settings.about.title')}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t('settings.about.description')}
          </p>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-slate-500">{row.label}</dt>
                <dd
                  className={
                    row.mono
                      ? 'font-mono text-slate-900'
                      : 'text-slate-900'
                  }
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
