import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase environment is not configured for shared ideas')
    }

    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey)

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Voce precisa entrar na sua conta para ver ideias compartilhadas.' }, 401)
    }

    const { data: members, error: membersError } = await serviceClient
      .from('organized_idea_share_members')
      .select('share_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (membersError) {
      throw new Error(membersError.message)
    }

    if (!members?.length) {
      return jsonResponse({ ideas: [] })
    }

    const shareIds = Array.from(new Set(members.map((member) => member.share_id)))

    const { data: shares, error: sharesError } = await serviceClient
      .from('organized_idea_shares')
      .select('id, source_idea_id, owner_user_id')
      .in('id', shareIds)

    if (sharesError) {
      throw new Error(sharesError.message)
    }

    const shareMap = new Map((shares || []).map((share) => [share.id, share]))
    const ideaIds = Array.from(new Set(
      (shares || []).map((share) => share.source_idea_id).filter(Boolean),
    ))

    if (!ideaIds.length) {
      return jsonResponse({ ideas: [] })
    }

    const { data: ideas, error: ideasError } = await serviceClient
      .from('organized_ideas')
      .select('*')
      .in('id', ideaIds)

    if (ideasError) {
      throw new Error(ideasError.message)
    }

    const ideaMap = new Map((ideas || []).map((idea) => [idea.id, idea]))
    const sharedIdeas = members
      .map((member) => {
        const share = shareMap.get(member.share_id)
        if (!share) return null

        const idea = ideaMap.get(share.source_idea_id)
        if (!idea) return null

        return {
          ...idea,
          share_id: share.id,
          shared_at: member.created_at,
          shared_by_user_id: share.owner_user_id,
        }
      })
      .filter((idea): idea is NonNullable<typeof idea> => Boolean(idea))

    return jsonResponse({ ideas: sharedIdeas })
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
