import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './security.ts'

export async function assertDailyAiQuota(
  adminClient: SupabaseClient,
  userId: string,
  route: string,
) {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const [{ data: usageRows, error: usageError }, { data: limitRow, error: limitError }] =
    await Promise.all([
      adminClient
        .from('ai_usage_ledger')
        .select('estimated_cost_usd')
        .eq('user_id', userId)
        .eq('route', route)
        .gte('created_at', startOfDay.toISOString()),
      adminClient
        .from('ai_usage_limits')
        .select('daily_cost_limit_usd,daily_request_limit')
        .eq('user_id', userId)
        .maybeSingle(),
    ])

  if (usageError || limitError) {
    throw json({ error: 'Quota check failed' }, 500)
  }

  const dailyCostLimit = Number(limitRow?.daily_cost_limit_usd ?? 1.0)
  const dailyRequestLimit = Number(limitRow?.daily_request_limit ?? 100)
  const currentRequests = usageRows?.length ?? 0
  const currentCost = (usageRows ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  )

  if (currentRequests >= dailyRequestLimit || currentCost >= dailyCostLimit) {
    throw json({ error: 'Daily AI quota exceeded' }, 429)
  }
}

export async function logAiUsage(
  adminClient: SupabaseClient,
  userId: string,
  route: string,
  units: number,
  estimatedCostUsd: number,
) {
  const { error } = await adminClient.from('ai_usage_ledger').insert({
    user_id: userId,
    route,
    units,
    estimated_cost_usd: estimatedCostUsd,
  })

  if (error) {
    console.error('Failed to log ai usage', error)
  }
}

export async function assertBusinessRateLimit(
  adminClient: SupabaseClient,
  userId: string,
  eventType: string,
  maxPerHour: number,
) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await adminClient
    .from('security_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('created_at', since)

  if (error) {
    throw json({ error: 'Rate limit check failed' }, 500)
  }

  if ((count ?? 0) >= maxPerHour) {
    throw json({ error: 'Too many requests' }, 429)
  }
}

export async function logSecurityEvent(
  adminClient: SupabaseClient,
  payload: {
    user_id?: string | null
    event_type: string
    target?: string | null
    ip?: string | null
    metadata?: Record<string, unknown>
  },
) {
  const { error } = await adminClient.from('security_events').insert({
    user_id: payload.user_id ?? null,
    event_type: payload.event_type,
    target: payload.target ?? null,
    ip: payload.ip ?? null,
    metadata: payload.metadata ?? {},
  })

  if (error) {
    console.error('Failed to log security event', error)
  }
}
