import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'

export type AuthedContext = {
  user: Pick<User, 'id' | 'email'>
  adminClient: SupabaseClient
  userClient: SupabaseClient
  authHeader: string
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json' }
}

export function readAuthHeader(req: Request) {
  const authHeader = req.headers.get('Authorization')?.trim()
  if (authHeader) {
    return authHeader
  }

  const customToken = req.headers.get('x-supabase-auth')?.trim()
  if (customToken) {
    return customToken.toLowerCase().startsWith('bearer ')
      ? customToken
      : `Bearer ${customToken}`
  }

  return ''
}

export async function requireUser(req: Request): Promise<AuthedContext> {
  const authHeader = readAuthHeader(req)
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw json({ error: 'Missing bearer token' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw json({ error: 'Server misconfiguration' }, 500)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    throw json({ error: 'Unauthorized' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
    },
    adminClient,
    userClient,
    authHeader,
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(),
  })
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
  )
}
