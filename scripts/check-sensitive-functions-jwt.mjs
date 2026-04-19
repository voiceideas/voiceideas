import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const configPath = resolve(process.cwd(), 'supabase/config.toml')
const config = readFileSync(configPath, 'utf8')

const selfManagedAuthFunctions = [
  'organize',
  'share-idea',
  'accept-idea-invite',
  'list-shared-ideas',
  'transcribe',
  'ingest-capture-session',
  'segment-audio-session',
  'transcribe-chunk',
  'materialize-idea',
  'export-to-cenax',
  'bridge-items',
  'delete-audio-chunk',
  'delete-capture-session',
  'link-bardo-account',
  'bridge-identity-check',
]

for (const functionName of selfManagedAuthFunctions) {
  const pattern = new RegExp(`\\[functions\\.${functionName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\][\\s\\S]*?verify_jwt\\s*=\\s*false`)
  if (!pattern.test(config)) {
    throw new Error(`Expected verify_jwt = false for ${functionName}`)
  }
}

console.log(`Verified self-managed auth mode for ${selfManagedAuthFunctions.length} authenticated functions.`)
