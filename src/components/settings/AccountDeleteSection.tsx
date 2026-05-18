/**
 * VI_LGPD_DELETE_ACCOUNT (2026-05-17)
 *
 * UI de "Apagar minha conta" com confirmação forte.
 *
 * Fluxo:
 *   1. Botão destructivo "Apagar minha conta" abaixo da seção
 *      Privacidade e legal no Settings.
 *   2. Click → modal full-screen com:
 *      - Lista do que será apagado (notas, áudios, sessões, etc).
 *      - Aviso de irreversibilidade.
 *      - Input "Digite APAGAR/DELETE/ELIMINAR para confirmar".
 *      - Botão "Apagar permanentemente" disabled até user digitar o
 *        keyword exato.
 *      - Botão "Cancelar".
 *   3. Confirmação → call edge function /delete-account.
 *   4. Loading state.
 *   5. Sucesso → cleanup local + navigate('/') (AuthGate redireciona
 *      para login porque sessão foi invalidada).
 *   6. Erro → mensagem amigável, permite tentar de novo.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { deleteAccount } from '../../lib/deleteAccount'
import { useI18n } from '../../hooks/useI18n'

type DeleteState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'deleting' }
  | { kind: 'error'; message: string }

export function AccountDeleteSection() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [state, setState] = useState<DeleteState>({ kind: 'idle' })
  const [confirmInput, setConfirmInput] = useState('')

  const confirmKeyword = t('settings.deleteAccount.modal.confirmKeyword')
  const matchesKeyword = confirmInput.trim() === confirmKeyword

  const openConfirm = () => {
    setConfirmInput('')
    setState({ kind: 'confirming' })
  }

  const closeConfirm = () => {
    if (state.kind === 'deleting') return // não permite cancelar durante delete
    setConfirmInput('')
    setState({ kind: 'idle' })
  }

  const handleConfirm = async () => {
    if (!matchesKeyword) return
    setState({ kind: 'deleting' })
    try {
      await deleteAccount()
      // Cleanup local + signOut já foram feitos por deleteAccount.
      // Navegar para "/" — AuthGate vai exibir login porque session
      // foi invalidada por resetLocalAuthState().
      navigate('/')
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('settings.deleteAccount.modal.errorGeneric')
      setState({ kind: 'error', message })
    }
  }

  return (
    <>
      <section className="rounded-xl border border-red-200 bg-red-50/50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-red-900">
              {t('settings.deleteAccount.title')}
            </h3>
            <p className="mt-1 text-sm text-red-800/80">
              {t('settings.deleteAccount.description')}
            </p>
            <button
              type="button"
              onClick={openConfirm}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
              {t('settings.deleteAccount.button')}
            </button>
          </div>
        </div>
      </section>

      {state.kind !== 'idle' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h2
                  id="delete-account-modal-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  {t('settings.deleteAccount.modal.title')}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t('settings.deleteAccount.modal.warning')}
                </p>
              </div>
            </div>

            <div className="my-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                {t('settings.deleteAccount.modal.willDeleteTitle')}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                <li>{t('settings.deleteAccount.modal.willDelete.notes')}</li>
                <li>{t('settings.deleteAccount.modal.willDelete.audio')}</li>
                <li>{t('settings.deleteAccount.modal.willDelete.organization')}</li>
                <li>{t('settings.deleteAccount.modal.willDelete.bardo')}</li>
                <li>{t('settings.deleteAccount.modal.willDelete.preferences')}</li>
              </ul>
            </div>

            <p className="mb-3 text-sm font-medium text-red-700">
              {t('settings.deleteAccount.modal.irreversible')}
            </p>

            <label className="mb-1 block text-xs font-medium text-slate-700">
              {t('settings.deleteAccount.modal.confirmInstruction', {
                keyword: confirmKeyword,
              })}
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              disabled={state.kind === 'deleting'}
              placeholder={confirmKeyword}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
            />

            {state.kind === 'error' && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {state.message}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={state.kind === 'deleting'}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                {t('settings.deleteAccount.modal.cancelButton')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirm()
                }}
                disabled={!matchesKeyword || state.kind === 'deleting'}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {state.kind === 'deleting' && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {state.kind === 'deleting'
                  ? t('settings.deleteAccount.modal.deleting')
                  : t('settings.deleteAccount.modal.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
