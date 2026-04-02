import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''

function assertSupabaseAuthEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase auth environment is not configured')
  }
}

export function readAuthHeader(req: Request) {
  const customToken = req.headers.get('x-supabase-auth')?.trim()
  if (customToken) {
    return customToken.toLowerCase().startsWith('bearer ')
      ? customToken
      : `Bearer ${customToken}`
  }

  return req.headers.get('Authorization') || ''
}

export function createAuthenticatedClient(req: Request) {
  assertSupabaseAuthEnv()

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: readAuthHeader(req) } },
  })
}

export interface AuthenticatedRequestContext {
  user: User
  client: SupabaseClient
}

export async function requireAuthenticatedRequest(req: Request): Promise<AuthenticatedRequestContext | null> {
  const client = createAuthenticatedClient(req)
  const { data: { user }, error } = await client.auth.getUser()

  if (error || !user) {
    return null
  }

  return { user, client }
}

