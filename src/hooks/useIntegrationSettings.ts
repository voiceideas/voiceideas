import { useContext } from 'react'
import { IntegrationSettingsContext } from '../context/integrationSettingsContext'

export function useIntegrationSettings() {
  const context = useContext(IntegrationSettingsContext)

  if (!context) {
    throw new Error('useIntegrationSettings must be used within IntegrationSettingsProvider')
  }

  return context
}
