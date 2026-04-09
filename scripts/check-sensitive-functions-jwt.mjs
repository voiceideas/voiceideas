import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const configPath = resolve(process.cwd(), 'supabase/config.toml')
const config = readFileSync(configPath, 'utf8')

const requiredJwtFunctions = [
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
  'delete-audio-chunk',
  'delete-capture-session',
]

for (const functionName of requiredJwtFunctions) {
  const pattern = new RegExp(`\\[functions\\.${functionName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\][\\s\\S]*?verify_jwt\\s*=\\s*true`)
  if (!pattern.test(config)) {
    throw new Error(`Expected verify_jwt = true for ${functionName}`)
  }
}

console.log(`Verified JWT enforcement for ${requiredJwtFunctions.length} authenticated functions.`)
