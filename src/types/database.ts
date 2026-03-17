export interface Note {
  id: string
  user_id: string
  raw_text: string
  title: string | null
  folder_id: string | null
  created_at: string
}

export interface Folder {
  id: string
  user_id: string
  name: string
  created_at: string
  note_count?: number
}

export interface OrganizedIdea {
  id: string
  user_id: string
  note_ids: string[]
  type: 'topicos' | 'plano' | 'roteiro' | 'mapa'
  title: string
  content: OrganizedContent
  created_at: string
}

export interface OrganizedContent {
  sections: {
    title: string
    items: string[]
  }[]
  summary?: string
}

export type ShareRole = 'viewer'

export interface OrganizedIdeaInvite {
  id: string
  idea_id: string
  invited_email: string
  role: ShareRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string
  accepted_by: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export interface OrganizedIdeaMember {
  id: string
  idea_id: string
  user_id: string
  role: ShareRole
  invited_by: string | null
  invite_id: string | null
  created_at: string
}

export interface UserProfile {
  id: string
  user_id: string
  daily_limit: number
  role: 'user' | 'admin'
  notes_used_today: number
  usage_date: string
  created_at: string
}

export type OrganizationType = OrganizedIdea['type']

export interface Database {
  public: {
    Tables: {
      notes: {
        Row: Note
        Insert: Omit<Note, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Note, 'id'>>
      }
      organized_ideas: {
        Row: OrganizedIdea
        Insert: Omit<OrganizedIdea, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdea, 'id'>>
      }
      organized_idea_invites: {
        Row: OrganizedIdeaInvite
        Insert: Omit<OrganizedIdeaInvite, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaInvite, 'id'>>
      }
      organized_idea_members: {
        Row: OrganizedIdeaMember
        Insert: Omit<OrganizedIdeaMember, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaMember, 'id'>>
      }
    }
  }
}
